package logs

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/kuberik/rollout-dashboard/pkg/kubernetes"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// truncateString truncates a string to maxLen characters
func truncateString(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}

// StreamPod represents a pod/container combination to stream logs from
type StreamPod struct {
	Pod       *corev1.Pod
	PodType   string
	Container string
}

// SSEMessage represents a message to send via SSE
type SSEMessage struct {
	Event string
	Data  string
}

// LogStreamer handles streaming logs from multiple pods
type LogStreamer struct {
	client          *kubernetes.Client
	discovery       *PodDiscovery
	sseChan         chan SSEMessage
	ctx             context.Context
	streamingPods   map[string]bool // key: "podName:containerName"
	streamingPodsMu sync.RWMutex
	wg              sync.WaitGroup
	sinceTime       *time.Time
}

// NewLogStreamer creates a new LogStreamer instance
func NewLogStreamer(client *kubernetes.Client, discovery *PodDiscovery, ctx context.Context, sinceTime *time.Time) *LogStreamer {
	return &LogStreamer{
		client:        client,
		discovery:     discovery,
		sseChan:       make(chan SSEMessage, 1000),
		ctx:           ctx,
		streamingPods: make(map[string]bool),
		sinceTime:     sinceTime,
	}
}

// Start begins streaming logs from discovered pods
func (ls *LogStreamer) Start() error {
	// Discover initial pods
	pods, err := ls.discovery.Discover(ls.ctx)
	if err != nil {
		return fmt.Errorf("failed to discover pods: %w", err)
	}

	// Send initial pods list
	if err := ls.sendPodsList(pods); err != nil {
		return fmt.Errorf("failed to send initial pods list: %w", err)
	}

	// Start streaming from initial pods
	streamPods, err := ls.convertToStreamPods(pods)
	if err != nil {
		return fmt.Errorf("failed to convert pods: %w", err)
	}

	for _, sp := range streamPods {
		ls.startStreamingPod(sp)
	}

	// Start periodic pod discovery
	ls.startPeriodicDiscovery()

	return nil
}

// GetSSEChannel returns the channel for SSE messages
func (ls *LogStreamer) GetSSEChannel() <-chan SSEMessage {
	return ls.sseChan
}

// Stop stops all streaming and closes the SSE channel
func (ls *LogStreamer) Stop() {
	close(ls.sseChan)

	// Wait for goroutines to finish (with timeout)
	done := make(chan struct{})
	go func() {
		ls.wg.Wait()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(5 * time.Second):
	}
}

// startStreamingPod starts streaming logs from a single pod/container
func (ls *LogStreamer) startStreamingPod(sp StreamPod) {
	key := fmt.Sprintf("%s:%s", sp.Pod.Name, sp.Container)

	ls.streamingPodsMu.Lock()
	if ls.streamingPods[key] {
		ls.streamingPodsMu.Unlock()
		return // Already streaming
	}
	ls.streamingPods[key] = true
	ls.streamingPodsMu.Unlock()

	ls.wg.Add(1)
	go func(sp StreamPod) {
		defer ls.wg.Done()
		defer func() {
			ls.streamingPodsMu.Lock()
			ls.streamingPods[key] = false
			ls.streamingPodsMu.Unlock()
		}()

		ls.streamPodLogs(sp)
	}(sp)
}

// streamPodLogs streams logs from a single pod/container
func (ls *LogStreamer) streamPodLogs(sp StreamPod) {
	clientset := ls.client.GetClientset()
	if clientset == nil {
		return
	}

	opts := &corev1.PodLogOptions{
		Container: sp.Container,
		Follow:    true,
	}

	if ls.sinceTime != nil {
		// Reconnection: only get logs since the last seen timestamp
		sinceTime := metav1.NewTime(*ls.sinceTime)
		opts.SinceTime = &sinceTime
	} else {
		// Initial connection: limit to most recent 1000 lines to avoid sending too much history
		tailLines := int64(1000)
		opts.TailLines = &tailLines
	}

	req := clientset.CoreV1().Pods(sp.Pod.Namespace).GetLogs(sp.Pod.Name, opts)
	stream, err := req.Stream(context.Background())
	if err != nil {
		return
	}
	defer stream.Close()

	lineCount := 0
	lastLineTime := time.Now()
	scanner := bufio.NewScanner(stream)

	// Monitor for stuck scanner (no data for 30 seconds)
	scannerStuck := make(chan bool, 1)
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ls.ctx.Done():
				return
			case <-ticker.C:
				timeSinceLastLine := time.Since(lastLineTime)
				if timeSinceLastLine > 30*time.Second && lineCount == 0 {
					scannerStuck <- true
				}
			}
		}
	}()

	for scanner.Scan() {
		select {
		case <-ls.ctx.Done():
			return
		default:
		}

		line := scanner.Text()
		if line == "" {
			continue
		}

		lineCount++
		lastLineTime = time.Now()

		// Use current time as timestamp (in milliseconds)
		now := time.Now()

		logLine := map[string]interface{}{
			"pod":       sp.Pod.Name,
			"container": sp.Container,
			"type":      sp.PodType,
			"line":      line,
			"timestamp": now.UnixMilli(),
		}

		jsonBytes, err := json.Marshal(logLine)
		if err != nil {
			continue
		}

		select {
		case <-ls.ctx.Done():
			return
		case ls.sseChan <- SSEMessage{Event: "log", Data: string(jsonBytes)}:
			// Successfully sent to channel
		default:
			// SSE channel full, dropping log line
		}
	}

	if err := scanner.Err(); err != nil {
		// Scanner error
	}
}

// startPeriodicDiscovery periodically checks for new pods and adds them to the stream
func (ls *LogStreamer) startPeriodicDiscovery() {
	ls.wg.Add(1)
	go func() {
		defer ls.wg.Done()
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-ls.ctx.Done():
				return
			case <-ticker.C:
				ls.discoverAndAddNewPods()
			}
		}
	}()
}

// discoverAndAddNewPods discovers new pods and starts streaming from them
func (ls *LogStreamer) discoverAndAddNewPods() {
	newPods, err := ls.discovery.Discover(ls.ctx)
	if err != nil {
		return
	}

	streamPods, err := ls.convertToStreamPods(newPods)
	if err != nil {
		return
	}

	var newStreamPods []StreamPod
	ls.streamingPodsMu.RLock()
	for _, sp := range streamPods {
		key := fmt.Sprintf("%s:%s", sp.Pod.Name, sp.Container)
		if !ls.streamingPods[key] {
			newStreamPods = append(newStreamPods, sp)
		}
	}
	ls.streamingPodsMu.RUnlock()

	if len(newStreamPods) == 0 {
		return
	}

	for _, sp := range newStreamPods {
		ls.startStreamingPod(sp)
	}

	// Send updated pods list
	if err := ls.sendPodsList(newPods); err != nil {
		// Error sending updated pods list
	}
}

// convertToStreamPods converts PodInfo to StreamPod with actual pod objects
func (ls *LogStreamer) convertToStreamPods(podInfos []PodInfo) ([]StreamPod, error) {
	var streamPods []StreamPod

	for _, podInfo := range podInfos {
		pods, err := ls.client.GetAllPods(ls.ctx, podInfo.Namespace)
		if err != nil {
			continue
		}

		for _, pod := range pods.Items {
			if pod.Name != podInfo.Name {
				continue
			}

			for _, container := range pod.Spec.Containers {
				streamPods = append(streamPods, StreamPod{
					Pod:       &pod,
					PodType:   podInfo.Type,
					Container: container.Name,
				})
			}
			break
		}
	}

	return streamPods, nil
}

// sendPodsList sends the pods list via SSE
func (ls *LogStreamer) sendPodsList(pods []PodInfo) error {
	podsJSON, err := json.Marshal(pods)
	if err != nil {
		return err
	}

	select {
	case <-ls.ctx.Done():
		return ls.ctx.Err()
	case ls.sseChan <- SSEMessage{Event: "pods", Data: string(podsJSON)}:
		return nil
	default:
		return fmt.Errorf("SSE channel full")
	}
}

// SendKeepalive sends a keepalive ping
func (ls *LogStreamer) SendKeepalive() {
	select {
	case <-ls.ctx.Done():
		return
	case ls.sseChan <- SSEMessage{Event: "ping", Data: "keepalive"}:
		// Keepalive sent
	default:
		// SSE channel full, cannot send keepalive
	}
}
