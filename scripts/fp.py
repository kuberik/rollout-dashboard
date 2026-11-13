p='/home/luka/projects/kuberik/.work/dedup-4/wt/frontend/src/lib/components/new/Footprint.svelte'
s=open(p).read()
old="const behindOf = (v: string | null) => { const i = v ? seq.indexOf(v) : -1; return i < 0 || newIdx < 0 ? 0 : Math.max(0, newIdx - i); };"
assert old in s
s=s.replace(old,"/* the ONE behind (dedup pass 4): the catalogue distance of the place, as the app page, the ledger and the rollout cards print it */\n\t\tconst behindOf = (e: { href?: string | null }) => (e.href ? behindOfPlace(e.href, app) : 0);")
s=s.replace("behindOf(e.version) > 0","behindOf(e) > 0").replace("behindOf(e.version) : 0","behindOf(e) : 0")
open(p,'w').write(s)
