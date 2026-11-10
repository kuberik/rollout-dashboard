import { it } from 'vitest';
import * as D from './data';
it('dump', () => {
	const A = D.apps('incident');
	const m = A.R.c.m as any;
	for (const n of ['invoice-api','checkout-api','payments-core']) {
		const a = m.apps.find((x: any) => x.app === n);
		console.log(n, JSON.stringify(A.items.find((i) => i.app === n)?.newest), JSON.stringify(a?.envs.map((e: any) => [e.env, e.label, e.tier, e.state, e.version, e.arrivedAt])));
		console.log(JSON.stringify((A.R.c as any).events.filter((e: any) => e.app === n).slice(0, 14)));
	}
	console.log(Object.keys(A.R.c));
});
