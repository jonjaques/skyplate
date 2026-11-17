function V() { this.lookup('x'); }
V.prototype.lookup = function lookup(x) { return x; };
new V();
