package oci

import (
	"archive/tar"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"

	"github.com/google/go-containerregistry/pkg/crane"
)

type File struct {
	Name    string
	Content []byte
}

func GetImageContents(ctx context.Context, image, version string, opts ...crane.Option) ([]File, error) {
	ref := fmt.Sprintf("%s:%s", image, version)

	// Get the image
	img, err := crane.Pull(ref, opts...)
	if err != nil {
		return nil, fmt.Errorf("failed to pull image: %w", err)
	}

	// Get the image layers
	layers, err := img.Layers()
	if err != nil {
		return nil, fmt.Errorf("failed to get image layers: %w", err)
	}

	var files []File
	for _, layer := range layers {
		// Get the uncompressed layer contents
		rc, err := layer.Uncompressed()
		if err != nil {
			return nil, fmt.Errorf("failed to get layer contents: %w", err)
		}
		defer rc.Close()

		// Read the tar archive
		tr := tar.NewReader(rc)
		for {
			header, err := tr.Next()
			if err == io.EOF {
				break
			}
			if err != nil {
				return nil, fmt.Errorf("failed to read tar header: %w", err)
			}

			// Skip directories and special files
			if header.Typeflag != tar.TypeReg {
				continue
			}

			// Read the file contents
			buf := new(bytes.Buffer)
			if _, err := io.Copy(buf, tr); err != nil {
				return nil, fmt.Errorf("failed to read file contents: %w", err)
			}

			files = append(files, File{
				Name:    header.Name,
				Content: buf.Bytes(),
			})
		}
	}

	return files, nil
}

// GetImageAnnotations returns the annotations for a given image.
func GetImageAnnotations(ctx context.Context, image, version string, opts ...crane.Option) (map[string]string, error) {
	ref := fmt.Sprintf("%s:%s", image, version)

	// Get the manifest for the image
	manifestBytes, err := crane.Manifest(ref, opts...)
	if err != nil {
		return nil, fmt.Errorf("failed to get manifest: %w", err)
	}

	var manifest struct {
		Annotations map[string]string `json:"annotations"`
	}
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
		return nil, fmt.Errorf("failed to unmarshal manifest: %w", err)
	}

	return manifest.Annotations, nil
}

// GetArtifactType returns the artifact/media type for the given image:tag by parsing the manifest.
// Preference order: manifest.artifactType (OCI 1.1 artifacts), then config.mediaType, then manifest.mediaType.
func GetArtifactType(ctx context.Context, image, version string, opts ...crane.Option) (string, error) {
	ref := fmt.Sprintf("%s:%s", image, version)

	manifestBytes, err := crane.Manifest(ref, opts...)
	if err != nil {
		return "", fmt.Errorf("failed to fetch manifest: %w", err)
	}

	var m struct {
		MediaType    string `json:"mediaType"`
		ArtifactType string `json:"artifactType"`
		Config       struct {
			MediaType string `json:"mediaType"`
		} `json:"config"`
	}
	if err := json.Unmarshal(manifestBytes, &m); err != nil {
		return "", fmt.Errorf("failed to unmarshal manifest: %w", err)
	}

	if m.ArtifactType != "" {
		return m.ArtifactType, nil
	}
	if m.Config.MediaType != "" {
		return m.Config.MediaType, nil
	}
	return m.MediaType, nil
}
