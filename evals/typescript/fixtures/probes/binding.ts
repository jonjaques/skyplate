export interface Binding { prop:number }
export function readBinding(b:Binding){const {prop:renamed}=b; return renamed}
export function readPlain(b:Binding){const {prop}=b;return prop}
