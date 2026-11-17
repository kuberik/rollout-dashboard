/**
 * The Gates-tab sentence of a hold that a health check causes ("what releases this"). While a check fails it releases when the check passes.
 * Once the check passes again the failed rollout is what still holds the builds: it needs a retry or a new build, so "when the check starts
 * passing" would be false. One sentence for the app page's Holding card and the Gates tab.
 */
export const checkHoldSentence = (recovered: boolean): string => (recovered ? 'The check passes again; a retry or a new build releases it' : 'Releases when the check starts passing');
