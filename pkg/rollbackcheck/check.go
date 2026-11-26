// Package rollbackcheck answers "what would a manual rollback of this Rollout to
// that history entry break?" without any HTTP or client in sight.
package rollbackcheck

import (
	"errors"

	rolloutv1alpha1 "github.com/kuberik/rollout-controller/api/v1alpha1"
	"github.com/kuberik/rollout-controller/pkg/rollbacksafety"
)

// ErrUnknownTag means the Rollout's history has no entry with the tag.
var ErrUnknownTag = errors.New("tag is not in the rollout's deployment history")

// Check returns every dependency break rolling rollout back to its history
// entry tagged tag would cause: consumers the target would stop serving, then
// contracts the target itself requires. Each break carries its Allowed flag;
// nothing is filtered. The result is never nil.
func Check(rollout *rolloutv1alpha1.Rollout, tag string, deps []rolloutv1alpha1.RolloutDependency, rollouts rollbacksafety.Rollouts) ([]rolloutv1alpha1.DependencyBreak, error) {
	var target *rolloutv1alpha1.VersionInfo
	for i := range rollout.Status.History {
		if rollout.Status.History[i].Version.Tag == tag {
			target = &rollout.Status.History[i].Version
			break
		}
	}
	if target == nil {
		return nil, ErrUnknownTag
	}
	out := []rolloutv1alpha1.DependencyBreak{}
	out = append(out, rollbacksafety.ConsumerBreaks(rollout, *target, deps, rollouts)...)
	out = append(out, rollbacksafety.TargetRequires(rollout, *target, deps, rollouts)...)
	return out, nil
}
