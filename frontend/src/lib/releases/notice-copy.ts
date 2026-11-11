/**
 * The lead sentence of the "no release source" notice, chosen by the REASON the
 * rollout-controller reported, not by string-swapping the controller's message.
 *
 * The controller's own message (`messageSourceRequired` and friends in
 * rollout-controller `internal/controller/rollout_slices.go`) is written for a
 * Rollout and is long; it goes in the panel's footnote, verbatim. What the
 * panel prints is one short line, in the dashboard's voice, about the subject
 * the page is about: "This Rollout" on a rollout page, "This app's rollout" on
 * an app page.
 *
 * Reasons (rollout-controller constants):
 *   ReleaseSourceRequired      spec.releaseSourceRef is not set
 *   ReleasesImagePolicyIgnored spec.releasesImagePolicy is set but no longer read
 *   NoReleases                 the ReleaseSource has published nothing yet
 */
export type NoticeReason = 'ReleaseSourceRequired' | 'ReleasesImagePolicyIgnored' | 'NoReleases';

export function noticeLead(reason: NoticeReason, app = false): string {
	const subject = app ? "This app's rollout" : 'This Rollout';
	switch (reason) {
		case 'ReleaseSourceRequired':
			return `${subject} has no release source, so it has no releases.`;
		case 'ReleasesImagePolicyIgnored':
			return `${subject} sets spec.releasesImagePolicy, which is ignored.`;
		case 'NoReleases':
			return app
				? "The release source of this app's rollout has not published any releases yet."
				: "This Rollout's release source has not published any releases yet.";
	}
}
