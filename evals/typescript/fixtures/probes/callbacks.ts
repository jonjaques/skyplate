export function cb(x=0) { return x+1; }
export function callbacks(){ [1].map(cb); setTimeout(cb,0); const f=cb; f(); cb.call(null,1); cb.apply(null,[1]); cb.bind(null)(1); cb?.(1); }
