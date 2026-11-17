export interface Root { run(): void }
export interface Middle extends Root { run(): void }
export class Base implements Middle { run() {} }
export class Leaf extends Base { run() {} }
export function dispatch(x: Root) { x.run(); }
dispatch(new Leaf());
