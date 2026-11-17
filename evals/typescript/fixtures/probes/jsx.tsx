export type AliasProps = { label: string; onClick():void };
export interface InterfaceProps { label:string; onClick():void }
export function AliasComp(p:AliasProps) { return null; }
export function InterfaceComp(p:InterfaceProps) { return null; }
export const el=<><AliasComp label='a' onClick={()=>{}}/><InterfaceComp label='b' onClick={()=>{}}/></>;
