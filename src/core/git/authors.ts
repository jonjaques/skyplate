/**
 * Author identity: which commits belong to the same person, and which "person" is a robot.
 *
 * Git has no notion of identity beyond the name/email pair on each commit (after .mailmap,
 * which git applies for us through %aN/%aE). People commit from several machines and
 * addresses, so the report groups them in two steps:
 *
 * 1. One identity per normalized email (lowercased; GitHub's "12345+user@users.noreply" and
 *    the older "user@users.noreply" forms collapse to the same key).
 * 2. Identities that share a normalized name are merged.
 *
 * Step 2 is a trade-off, made deliberately. It fixes the far more common failure — one person
 * split across a work and a personal address, which halves their ownership and inflates the
 * truck factor — at the price of fusing two different people who share a full name, and of
 * chaining (A@x "Sam" + A@x "Sam Lee" + B@y "Sam Lee"). Placeholder names ("root", "Your Name",
 * "unknown") never merge, and a bot never merges with a human, because those are where the
 * collisions would be systematic rather than unlucky.
 *
 * Two more places are systematic, both found on vite:
 *
 * - Stray names. green@sapphi.red has 1,476 commits, 2 of them (GitHub squash merges) under
 *   "andrew", another contributor's name. Merging on every name an address ever carried
 *   pulled that contributor's 46 commits into vite's top author. So an identity merges only on
 *   names it goes by: its most-used, one on a quarter of its commits, or one used ten times or
 *   more, which is a habit rather than an accident. The last clause is not optional: the same
 *   address used "sapphi-red" on 17 commits (1%), and that is what joins it to the 448 commits
 *   from the sapphi-red noreply address.
 *
 * - Bare given names. One word, written as a name is written ("Alex", "Mark", "Leo", in a
 *   script that spaces its words), collides as a matter of course: vite's "alex" was five
 *   people. But a bare handle is the commonest spelling that *should* merge: "patak" joins
 *   vite's third most active author (919 commits) to the patak-dev noreply address (91), and
 *   "underfin", "sun0day", "ygj6" and 13 more one-word groups in vite are handles too. Handles
 *   keep their account spelling (lowercase, digits, inner capitals), so only the capitalized
 *   word is held back. It errs both ways on a few small identities ("alex" typed lowercase
 *   still merges, the handle "Zheeeng" does not), where skipping every one-word name would
 *   have split all 17 handle groups. CJK names ("김정환") have no such convention and stay
 *   mergeable.
 */

// ─── Bot detection ───────────────────────────────────────────────────────────────────────────

/**
 * Matched against the display name and against the email's local part (never the domain:
 * "jon@bot.example" is a person). `\bbot\b` catches "Renovate Bot", "jade-bot" and "[bot]"
 * accounts without tripping on real names seen in the test repositories — "Lowell Abbott",
 * "Henré Botha", "Marc Hernandez Cabot", "kumabotz", "stevenprobot" all stay human. "travis"
 * alone is a first name, so only "travis-ci" / "Travis CI" count.
 */
const BOT_PATTERN = new RegExp(
  [
    String.raw`\[bot\]`, //          GitHub Apps: dependabot[bot], renovate[bot], copilot-swe-agent[bot]
    String.raw`\bbot\b`, //          "Renovate Bot", "jade-bot", "bot@renovateapp.com"
    "dependabot",
    "renovate",
    String.raw`github[- ]actions?\b`, // "github-actions", "GitHub Action" <action@github.com>
    "actions-user",
    "github-merge-queue",
    "greenkeeper",
    "snyk-bot",
    "pre-commit-ci",
    "mergify",
    "imgbot", //                     "ImgBotApp"
    "all-?contributors",
    "semantic-release",
    "codecov",
    "gitter-badger",
    "travis[- ]ci",
    "circleci",
    "azure-pipelines",
    "restyled-io",
  ].join("|"),
  "i",
);

/** Whole addresses automation commits from whose local part looks human. */
const BOT_EMAILS = new Set([
  "action@github.com",
  "actions@github.com",
  "support@dependabot.com",
  "noreply@weblate.org",
]);

export function isBot(name: string, email: string): boolean {
  if (BOT_PATTERN.test(name)) return true;
  const at = email.lastIndexOf("@");
  if (BOT_PATTERN.test(at >= 0 ? email.slice(0, at) : email)) return true;
  return BOT_EMAILS.has(email);
}

// ─── Normalization ───────────────────────────────────────────────────────────────────────────

const NOREPLY = "@users.noreply.github.com";

export function normalizeEmail(email: string): string {
  const e = email.trim().toLowerCase();
  if (e.endsWith(NOREPLY)) {
    const plus = e.indexOf("+");
    if (plus > 0 && plus < e.length - NOREPLY.length) return e.slice(plus + 1);
  }
  return e;
}

/** "José  O'Neil" and "jose oneil" compare equal; punctuation and accents are noise here. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Names that many unrelated people commit under; merging on them would be systematic. */
const PLACEHOLDER_NAMES = new Set([
  "",
  "admin",
  "administrator",
  "anonymous",
  "author",
  "default",
  "dev",
  "developer",
  "git",
  "github",
  "localhost",
  "me",
  "name",
  "nobody",
  "none",
  "root",
  "system",
  "test",
  "ubuntu",
  "unknown",
  "user",
  "you",
  "your name",
]);

/** A name on this many of an identity's commits is one it goes by, whatever its share. */
const NAME_HABIT = 10;
/** Scripts that separate words with spaces, where one word alone is a first name or a handle. */
const SPACED_SCRIPT = /^[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{N}]+$/u;
/** A single word written the way names are: one capital, then lowercase ("Alex", "Владимир"). */
const NAME_CASED = /^\p{Lu}\p{Ll}+$/u;

/** `raw` as committed, `norm` its normalizeName form. See the header for why. */
function isBareGivenName(raw: string, norm: string): boolean {
  return (
    !norm.includes(" ") && SPACED_SCRIPT.test(norm) && NAME_CASED.test(raw.trim().normalize("NFC"))
  );
}

// ─── Raw identities (built during the log pass) ──────────────────────────────────────────────

export class Identities {
  /** Exact "name\0email" → id, so the normalization above runs once per pair, not per commit. */
  private readonly exact = new Map<string, number>();
  private readonly byKey = new Map<string, number>();
  readonly email: string[] = [];
  /** Display names seen for each identity, with commit counts, to pick the most used. */
  readonly names: Map<string, number>[] = [];
  readonly commits: number[] = [];
  readonly bot: boolean[] = [];

  get size(): number {
    return this.email.length;
  }

  /** Identity id for one commit's author; counts the commit. */
  add(name: string, email: string): number {
    const pair = name + "\0" + email;
    let id = this.exact.get(pair);
    if (id === undefined) {
      const mail = normalizeEmail(email);
      // A missing email cannot key anything, so fall back to the name alone.
      const key = mail.length > 0 ? mail : "\0" + normalizeName(name);
      id = this.byKey.get(key);
      if (id === undefined) {
        id = this.email.length;
        this.byKey.set(key, id);
        this.email.push(mail);
        this.names.push(new Map());
        this.commits.push(0);
        this.bot.push(false);
      }
      this.exact.set(pair, id);
      if (isBot(name, mail)) this.bot[id] = true;
    }
    const names = this.names[id]!;
    names.set(name, (names.get(name) ?? 0) + 1);
    this.commits[id]!++;
    return id;
  }
}

// ─── Merging into authors ────────────────────────────────────────────────────────────────────

export interface MergedAuthor {
  name: string;
  email: string;
  bot: boolean;
  commits: number;
}

/**
 * Groups identities by shared normalized name (union-find), then orders the groups by commit
 * count so author id 0 is the most active. `groupOf[identity]` is the final author id.
 */
export function mergeIdentities(ids: Identities): { groupOf: Int32Array; authors: MergedAuthor[] } {
  const n = ids.size;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x: number): number => {
    while (parent[x]! !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };

  const firstWithName = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const names = ids.names[i]!;
    const total = ids.commits[i]!;
    let most = 0;
    for (const count of names.values()) if (count > most) most = count;
    for (const [raw, count] of names) {
      if (count < most && count * 4 < total && count < NAME_HABIT) continue; // a stray name
      const norm = normalizeName(raw);
      if (PLACEHOLDER_NAMES.has(norm) || norm.length < 2) continue;
      // Bots are exempt: their one word is a product name ("Mergify"), and two bot accounts
      // of one product merging only ever groups automation with automation.
      if (!ids.bot[i] && isBareGivenName(raw, norm)) continue;
      const key = (ids.bot[i] ? "b:" : "h:") + norm;
      const other = firstWithName.get(key);
      if (other === undefined) firstWithName.set(key, i);
      else {
        const ra = find(i);
        const rb = find(other);
        if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
      }
    }
  }

  // Collect groups keyed by root, then rank.
  const members = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const list = members.get(r);
    if (list) list.push(i);
    else members.set(r, [i]);
  }

  const groups: (MergedAuthor & { root: number; members: number[] })[] = [];
  for (const [root, list] of members) {
    const nameCounts = new Map<string, number>();
    let commits = 0;
    let bestEmail = list[0]!;
    let bot = false;
    for (const i of list) {
      commits += ids.commits[i]!;
      if (ids.commits[i]! > ids.commits[bestEmail]!) bestEmail = i;
      bot ||= ids.bot[i]!;
      for (const [name, count] of ids.names[i]!)
        nameCounts.set(name, (nameCounts.get(name) ?? 0) + count);
    }
    groups.push({
      root,
      members: list,
      name: pickName(nameCounts),
      email: ids.email[bestEmail]!,
      bot,
      commits,
    });
  }
  // Ties broken by email then root so ids are stable across runs on the same history.
  groups.sort(
    (a, b) =>
      b.commits - a.commits || (a.email < b.email ? -1 : a.email > b.email ? 1 : a.root - b.root),
  );

  const groupOf = new Int32Array(n);
  groups.forEach((g, id) => {
    for (const i of g.members) groupOf[i] = id;
  });
  return {
    groupOf,
    authors: groups.map(({ name, email, bot, commits }) => ({ name, email, bot, commits })),
  };
}

/** Most-used spelling; on a tie the longer one, since "Jon Jaques" says more than "jon". */
function pickName(counts: Map<string, number>): string {
  let best = "";
  let bestCount = -1;
  for (const [name, count] of counts) {
    if (
      count > bestCount ||
      (count === bestCount &&
        (name.length > best.length || (name.length === best.length && name < best)))
    ) {
      best = name;
      bestCount = count;
    }
  }
  return best;
}
