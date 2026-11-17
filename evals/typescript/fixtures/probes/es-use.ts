import def from './source';
import * as ns from './star';
import { renamed as local } from './renamed';
export async function consume(){def(); ns.original(); local(); const m=await import('./source');m.extra();}
