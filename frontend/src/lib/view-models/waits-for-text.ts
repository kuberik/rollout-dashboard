import { joinClauses } from './blocking-story';

/**
 * THE ONE SENTENCE BUILDER for "Waits for ..." over the clauses a rollout waits on. `classifyGate`'s clause text is written to follow "until"
 * ("someone approves it", "the deploy window reopens"); as the object of "Waits for" each clause is re-inflected ON ITS OWN, then the clauses are
 * joined, so a joined cause never carries two finite verbs ("Waits for an approval and the deploy window to reopen"). Display-only.
 */
const inflect = (clause: string): string => {
	if (clause === 'someone approves it') return 'an approval';
	if (clause === 'the deploy window reopens') return 'the deploy window to reopen';
	if (clause === 'a check starts passing') return 'a check to start passing';
	return clause.replace(/\bdeploys\b/g, 'to deploy').replace(/\bships\b/g, 'to ship').replace(/\ballows\b/g, 'to allow');
};
export const waitsForText = (clauses: string[]): string => joinClauses(clauses.map(inflect));
