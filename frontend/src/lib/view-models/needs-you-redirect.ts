/** "Needs you" became Home: the old route 308s to "/" keeping the query (?calm=1, ?quiet=1, ...). */
export const needsYouRedirect = (url: URL): string => `/${url.search}`;
