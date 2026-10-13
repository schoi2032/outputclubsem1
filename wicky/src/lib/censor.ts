const WORDS = [
  "fuck", "shit", "bitch", "asshole", "bastard", "dick", "pussy", "cunt", "slut", "whore",
  "fag", "faggot", "retard", "nigger", "nigga", "motherfucker", "bullshit", "dumbass", "jackass", "wanker",
  "twat", "prick", "cock", "douche", "piss",
];

const ALLOWED = ["dickens", "cockpit", "peacock", "hancock", "scunthorpe", "assessment", "classic", "bass", "pass", "shiitake", "dickinson", "prickly", "cocktail", "hitchcock"];

const LEET: Record<string, string> = { "0": "o", "1": "i", "!": "i", "3": "e", "4": "a", "@": "a", "5": "s", "$": "s", "7": "t", "+": "t" };

function squash(word: string) {
  return word
    .toLowerCase()
    .split("")
    .map((ch) => LEET[ch] ?? ch)
    .join("")
    .replace(/[^a-z]/g, "")
    .replace(/(.)\1+/g, "$1");
}

const SQUASHED = WORDS.map(squash);

export function isSwear(word: string) {
  const clean = squash(word);
  if (!clean || ALLOWED.some((ok) => clean.includes(squash(ok)))) return false;
  return SQUASHED.some((bad) => clean === bad || clean === `${bad}s` || clean === `${bad}ing` || clean === `${bad}er` || clean === `${bad}ed` || (bad.length >= 4 && clean.includes(bad)));
}

export function censor(text: string) {
  let hits = 0;
  const out = text.replace(/[^\s]+/g, (token) => {
    const match = token.match(/^([^a-zA-Z0-9@$]*)(.*?)([^a-zA-Z0-9@$]*)$/);
    const [, before, core, after] = match ?? ["", "", token, ""];
    if (!isSwear(core)) return token;
    hits++;
    return before + "*".repeat(Math.max(core.length, 3)) + after;
  });
  return { text: out, censored: hits > 0, hits };
}
