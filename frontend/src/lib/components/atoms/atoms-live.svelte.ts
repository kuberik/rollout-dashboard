import { progressMap } from './atoms-data';

/** one shared, reactive read of the live fleet's progress facts (computed once per change of the source, not per row) */
const pm = $derived(progressMap('incident'));
export const liveProgress = () => pm;
