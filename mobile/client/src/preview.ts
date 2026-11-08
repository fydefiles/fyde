// Offline design preview. Development builds can open the app with sample
// files and a simulated assistant so the interface can be reviewed without a
// server. Nothing here is sent anywhere, and none of it is real matching: the
// "describe a file" flow uses a small keyword scorer as a stand-in.
import type { Channel, Choice, Contact, FileCard, Turn, Workspace } from "./types";

export const PREVIEW_TOKEN = "fyde-design-preview";

class PreviewError extends Error {
  status = 400;
}
const day = 86400000;
const ago = (days: number) => new Date(Date.now() - days * day).toISOString();
const thisYear = (month: number, date: number) => {
  const d = new Date(new Date().getFullYear(), month, date, 10);
  return (d.getTime() > Date.now() ? new Date(d.getTime() - 365 * day) : d).toISOString();
};

const matters = [
  { id: "m-imm", name: "Immigration" },
  { id: "m-apt", name: "Apartment" },
  { id: "m-tax", name: "Taxes 2025" },
  { id: "m-job", name: "Job search" },
];
const contacts: Contact[] = [
  {
    id: "c-john",
    name: "John Carter",
    relationship: "Lawyer",
    endpoint: "john@carterlaw.example",
    email: "john@carterlaw.example",
    phone: "",
    verified: true,
    aliases: "my lawyer, attorney",
  },
  {
    id: "c-maya",
    name: "Maya Chen",
    relationship: "Accountant",
    endpoint: "maya@ledger.example",
    email: "maya@ledger.example",
    phone: "",
    verified: true,
    aliases: "my accountant, cpa",
  },
  {
    id: "c-priya",
    name: "Priya Patel",
    relationship: "Landlord",
    endpoint: "priya@elmstreet.example",
    email: "priya@elmstreet.example",
    phone: "",
    verified: true,
    aliases: "my landlord",
  },
  {
    id: "c-mom",
    name: "Mom",
    relationship: "Family",
    endpoint: "+1 555 0100",
    email: "",
    phone: "+1 555 0100",
    verified: false,
    aliases: "mum, mother",
  },
];

type Seed = [
  title: string,
  ext: string,
  kb: number,
  modified: string,
  matter: string,
  keywords: string,
  snippet?: string,
  sensitive?: boolean,
];
const seeds: Seed[] = [
  ["Passport scan", "jpg", 2410, ago(12), "m-imm", "passport id identity travel photo page", "Passport · photo page · expires 2031", true],
  ["Passport scan (old)", "jpg", 1980, ago(1190), "m-imm", "passport expired previous identity", "Passport · expired 2023", true],
  ["Visa application form", "pdf", 820, ago(6), "m-imm", "visa application form immigration signed", "Application for a temporary work visa"],
  ["Birth certificate", "pdf", 640, ago(240), "m-imm", "birth certificate identity civil record", "Certificate of birth · certified copy", true],
  ["Notes – visa interview", "txt", 4, ago(3), "m-imm", "notes visa interview questions consulate", "Bring passport, offer letter and two photos"],
  ["Proof of address – October", "pdf", 310, ago(28), "m-imm", "proof address utility statement residence"],
  ["Lease agreement – 14 Elm St", "pdf", 1260, thisYear(2, 14), "m-apt", "lease rental apartment contract signed landlord rent elm", "Residential lease · 14 Elm Street · signed 14 March"],
  ["Lease agreement – 2023", "pdf", 1110, ago(900), "m-apt", "lease rental old previous apartment contract", "Residential lease · 220 Oak Ave · 2023"],
  ["Renter's insurance", "pdf", 450, ago(70), "m-apt", "insurance renters policy apartment coverage"],
  ["Move-in inspection photos", "zip", 48200, thisYear(2, 16), "m-apt", "inspection photos move apartment condition"],
  ["Kitchen before move-in", "jpg", 3120, thisYear(2, 16), "m-apt", "kitchen photo apartment move inspection"],
  ["Electric bill – September", "pdf", 210, ago(44), "m-apt", "electric bill utility power invoice"],
  ["Tax return 2025", "pdf", 2300, ago(190), "m-tax", "tax return irs federal filing 1040", "Form 1040 · filed April", true],
  ["W-2 – Northwind", "pdf", 180, ago(270), "m-tax", "w2 wage tax statement employer northwind"],
  ["Deductions tracker", "xlsx", 96, ago(15), "m-tax", "deductions tax tracker expenses spreadsheet"],
  ["Charity receipts", "pdf", 520, ago(120), "m-tax", "charity donation receipts tax deduction"],
  ["Résumé – 2026", "docx", 88, ago(9), "m-job", "resume cv experience latest", "Product designer · 8 years · Lisbon & remote"],
  ["Résumé – 2024", "docx", 79, ago(610), "m-job", "resume cv old previous"],
  ["Cover letter – Northwind", "docx", 42, ago(20), "m-job", "cover letter application northwind"],
  ["Offer letter – Northwind", "pdf", 230, ago(18), "m-job", "offer letter job employment northwind salary", "We are pleased to offer you the role of Senior Designer"],
  ["Portfolio deck", "pptx", 18400, ago(11), "m-job", "portfolio deck slides presentation work"],
  ["References", "txt", 3, ago(19), "m-job", "references contacts recommendation"],
  ["Bank statement – October", "pdf", 340, ago(7), "", "bank statement account october transactions"],
  ["Bank statement – September", "pdf", 330, ago(37), "", "bank statement account september transactions"],
  ["Monthly budget", "xlsx", 64, ago(2), "", "budget monthly expenses spreadsheet money"],
  ["Driver's licence – front", "heic", 2860, ago(400), "", "drivers license licence id identity card front", undefined, true],
  ["Driver's licence – back", "heic", 2710, ago(400), "", "drivers license licence id identity card back", undefined, true],
  ["Vaccination record", "pdf", 150, ago(500), "", "vaccination vaccine record health immunization"],
  ["Car insurance card", "pdf", 120, ago(60), "", "car auto insurance card policy vehicle"],
  ["Wedding invitation", "png", 1450, ago(33), "", "wedding invitation card ceremony"],
  ["Trip itinerary – Lisbon", "pdf", 280, ago(25), "", "trip itinerary lisbon travel flights hotel"],
  ["Boarding pass – LIS", "png", 410, ago(24), "", "boarding pass flight lisbon airline ticket"],
  ["Gym contract", "pdf", 200, ago(150), "", "gym contract membership fitness"],
  ["Phone bill – October", "pdf", 160, ago(8), "", "phone bill mobile invoice october"],
  ["Holiday video", "mov", 182000, ago(40), "", "holiday video vacation family"],
  ["Medical referral", "pdf", 230, ago(14), "", "medical referral doctor specialist health", undefined, true],
  ["Dental x-ray", "jpg", 1720, ago(14), "", "dental xray x-ray teeth dentist health"],
  ["Freelance invoice #014", "pdf", 90, ago(48), "", "invoice freelance client payment"],
  ["Freelance invoice #015", "pdf", 92, ago(17), "", "invoice freelance client payment latest"],
  ["Project timeline", "xlsx", 75, ago(5), "", "project timeline plan schedule spreadsheet"],
  ["Team offsite photos", "zip", 96000, ago(55), "", "team offsite photos work event"],
  ["Grandma's baklava recipe", "txt", 2, ago(300), "", "recipe baklava grandma dessert cooking"],
];
const keywords = new Map<string, string>();
let files: FileCard[] = seeds.map(([title, ext, kb, modified, matter, words, snippet, sensitive], i) => {
  const id = `pv-${i + 1}`;
  keywords.set(id, words);
  return {
    id,
    document_id: `pd-${i + 1}`,
    title,
    name: `${title.replace(/[^\w()#-]+/g, "_")}.${ext}`,
    number: title.includes("Lease agreement – 14") ? 2 : 1,
    size: kb * 1024,
    state: "ready",
    document_type: "general",
    matter: matters.find((m) => m.id === matter)?.name || "",
    matter_id: matter || undefined,
    sensitive: !!sensitive,
    modified_at: modified,
    snippet,
  };
});
const received: FileCard[] = [
  ["Signed retainer agreement", "pdf", 380, 2, "John Carter"],
  ["Immigration checklist", "docx", 54, 4, "John Carter"],
  ["2025 tax summary", "pdf", 610, 9, "Maya Chen"],
  ["Building rules", "pdf", 220, 30, "Priya Patel"],
  ["Spare key photo", "jpg", 1300, 31, "Priya Patel"],
].map(([title, ext, kb, days, from], i) => ({
  id: `pr-${i + 1}`,
  document_id: `prd-${i + 1}`,
  item_id: `pri-${i + 1}`,
  title: title as string,
  name: `${(title as string).replace(/\W+/g, "_")}.${ext}`,
  number: 1,
  size: (kb as number) * 1024,
  state: "ready",
  document_type: "general",
  matter: "",
  from: from as string,
  available: true,
  modified_at: ago(days as number),
  api_download_url: `/api/v1/received/pri-${i + 1}/download/`,
}));

let user: Workspace["user"] = {
  id: 1,
  name: "Alex",
  email: "alex@preview.example",
  email_verified: true,
  data_mode: "preview",
  onboarding_complete: true,
  default_channel: "in_app",
  sharing_paused: false,
  chat_context_enabled: true,
};
let turns: Turn[] = [];
let consumed = 3;
let counter = 0;

const STOP = new Set(
  "the a an my our your to for of in on at with and or please can could would you me i it its this that these those file files document documents doc copy version send share email text forward give find show where is was get need want one thing some him her them".split(
    " ",
  ),
);
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const KIND_WORDS: Record<string, string[]> = {
  photo: ["jpg", "jpeg", "png", "heic"],
  picture: ["jpg", "jpeg", "png", "heic"],
  image: ["jpg", "jpeg", "png", "heic"],
  scan: ["jpg", "png", "heic", "pdf"],
  pdf: ["pdf"],
  spreadsheet: ["xlsx", "csv"],
  excel: ["xlsx", "csv"],
  sheet: ["xlsx", "csv"],
  deck: ["pptx"],
  slides: ["pptx"],
  video: ["mov", "mp4"],
};
const normalize = (text: string) =>
  text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const words = (text: string) =>
  normalize(text)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w));

function rank(description: string, pool: FileCard[] = files) {
  const terms = words(description);
  const wantsOld = terms.some((t) => ["old", "older", "previous", "expired"].includes(t));
  const scored = pool.map((file) => {
    const title = words(file.title);
    const extra = words(`${keywords.get(file.id) || ""} ${file.snippet || ""}`);
    const ext = file.name.split(".").pop() || "";
    const month = file.modified_at ? MONTHS[new Date(file.modified_at).getMonth()] : "";
    let score = 0,
      covered = 0;
    const inName: string[] = [],
      inside: string[] = [],
      other: string[] = [];
    for (const term of terms) {
      if (title.some((w) => w === term || (term.length > 3 && w.startsWith(term)))) {
        score += 3;
        covered++;
        inName.push(term);
      } else if (extra.some((w) => w === term || (term.length > 3 && w.startsWith(term)))) {
        score += 2;
        covered++;
        inside.push(term);
      } else if (KIND_WORDS[term]?.includes(ext)) {
        score += 1.5;
        covered++;
        other.push(term);
      } else if (term === month) {
        score += 1.5;
        covered++;
        other.push(`changed in ${term[0].toUpperCase()}${term.slice(1)}`);
      } else if (normalize(file.matter).includes(term)) {
        score += 1;
        covered++;
        other.push(`in ${file.matter}`);
      }
    }
    const age = file.modified_at ? (Date.now() - new Date(file.modified_at).getTime()) / day : 9999;
    if (score > 0) score += wantsOld ? Math.min(age / 1500, 0.9) : Math.max(0, 0.9 - age / 1500);
    const q = (list: string[]) => list.map((w) => `“${w}”`).join(" and ");
    const reason = [
      inName.length ? `${q(inName)} in the name` : "",
      inside.length ? `${q(inside)} in its contents` : "",
      ...other,
    ]
      .filter(Boolean)
      .join(", ");
    return { file, score, coverage: terms.length ? covered / terms.length : 0, reason };
  });
  const hits = scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  return hits.map((hit, i) => {
    const next = hits[i + 1];
    const exact = i === 0 && hit.coverage === 1 && (!next || next.score < hit.score);
    let reason = hit.reason ? `Matched ${hit.reason}` : "Closest match";
    if (i === 0 && next && next.coverage === 1 && exact)
      reason += wantsOld ? ` · older than “${next.file.title}”` : ` · newer than “${next.file.title}”`;
    return { ...hit.file, match: { exact, reason } } as FileCard;
  });
}

function findContact(text: string) {
  const t = normalize(text)
    .replace(/[.!?]+$/, "")
    .replace(/\b(by|via|over)\s+(email|sms|text|fyde)$/, "")
    .trim()
    .replace(/^(my|our)\s+/, "");
  if (!t) return undefined;
  return contacts.find((c) => {
    const names = [c.name, c.name.split(" ")[0], c.relationship, ...(c.aliases || "").split(",")].map((n) =>
      normalize(n).trim().replace(/^(my|our)\s+/, ""),
    );
    return names.some((n) => n && (n === t || t.startsWith(n + " ") || t.endsWith(" " + n)));
  });
}

let pending: { files: FileCard[]; channel: Channel } | null = null;

function turn(message: string, reply: string, result: Turn["result"]): Turn {
  const value = { id: `pt-${++counter}`, message, reply, result };
  turns = [...turns, value];
  return value;
}

function chat(message: string, channel: Channel, choice?: Choice): Turn {
  if (choice?.confirmed && choice.version_id) {
    const file = files.find((f) => f.id === choice.version_id);
    const contact = contacts.find((c) => c.id === choice.contact_id);
    if (!file || !contact) throw new PreviewError("That proposal is no longer available.");
    consumed++;
    pending = null;
    const first = contact.name.split(" ")[0];
    return turn(message, `Done — “${file.title}” is on its way to ${first}.`, {
      kind: "sent",
      transfers: [
        {
          id: `ptr-${counter}`,
          title: `Sent to ${contact.name}`,
          state: "available_in_app",
          message:
            channel === "email"
              ? `Download link emailed to ${contact.email || contact.endpoint} · v${file.number}`
              : channel === "phone"
                ? `Download link texted to ${contact.phone || contact.endpoint} · v${file.number}`
                : `In ${first}’s Received · v${file.number} · 1 send used`,
        },
      ],
    });
  }
  if (choice?.contact_id && pending) {
    const contact = contacts.find((c) => c.id === choice.contact_id)!;
    const proposal = pending;
    return turn(message, `Before I send anything to ${contact.name.split(" ")[0]}, is this the file you mean?`, {
      kind: "confirm",
      files: proposal.files,
      contacts: [contact],
      channel: proposal.channel,
    });
  }
  if (choice?.version_id) {
    const file = files.find((f) => f.id === choice.version_id);
    return turn(message, file ? `Here it is.` : "I couldn’t find that file.", {
      kind: "search",
      files: file ? [file] : [],
    });
  }
  const text = normalize(message).trim();
  if (/^(add|import|upload)\b/.test(text))
    return turn(message, "You can import documents from Files or iCloud. Uploading is turned off in the sample preview.", {
      kind: "workspace_action",
      section: "files",
      action_label: "Open file import",
    });
  if (/\b(received|sent me|send me)\b/.test(text) && !/\bto\b/.test(text))
    return turn(message, `You have ${received.length} received files.`, { kind: "received", files: received });
  if (/\brequest\b/.test(text))
    return turn(message, "Requests work under a case someone shared with you. There are none in this preview yet.", {
      kind: "none",
    });
  const sendMatch = /\b(send|share|email|text|forward|give)\b(.*)$/.exec(text);
  if (sendMatch) {
    const rest = sendMatch[2];
    const split = rest.lastIndexOf(" to ");
    const description = split >= 0 ? rest.slice(0, split) : rest;
    const recipient = split >= 0 ? rest.slice(split + 4) : "";
    const contact = findContact(recipient);
    const chosen = /\b(by|via)\s+email$/.test(text) ? "email" : /\b(by|via)\s+(sms|text)$/.test(text) ? "phone" : channel;
    const matches = rank(description).slice(0, 4);
    if (!matches.length)
      return turn(message, "I couldn’t find a file like that. Try describing what’s in it, who it’s from, or roughly when you got it.", {
        kind: "none",
      });
    if (!contact) {
      pending = { files: matches, channel: chosen };
      return turn(message, recipient ? `I don’t have “${recipient}” in your contacts. Who should receive it?` : "Who should receive it?", {
        kind: "clarify_contact",
        contacts,
      });
    }
    const exact = matches[0].match?.exact;
    return turn(
      message,
      exact
        ? `I found it. Check this is the right file before I send it to ${contact.name.split(" ")[0]}.`
        : `This is the closest match, but there are similar files. Which one should ${contact.name.split(" ")[0]} get?`,
      { kind: "confirm", files: matches, contacts: [contact], channel: chosen },
    );
  }
  const description = text.replace(/^(find|show|where('s| is)?|search( for)?|look( for)?|open)\s+/, "");
  const matches = rank(description).slice(0, 8);
  if (matches.length)
    return turn(message, matches[0].match?.exact ? "Here’s the file, plus a few related ones." : `Here’s what matches “${description}”.`, {
      kind: "search",
      files: matches,
    });
  return turn(message, "Tell me which file you need and who it’s for — for example “send my lease to Priya”.", { kind: "none" });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function previewCall<T>(path: string, method: string, data?: unknown): Promise<T> {
  await sleep(method === "GET" ? 120 : 520);
  const body = (data || {}) as Record<string, unknown>;
  const state = (): Workspace => ({
    user,
    files,
    contacts,
    matters,
    document_types: [
      { id: "general", name: "General" },
      { id: "identity", name: "Identity" },
      { id: "financial", name: "Financial" },
      { id: "housing", name: "Housing" },
    ],
    policies: [],
    received_permissions: [],
    plan: { sends: 50, file_mib: 25, storage_mib: 2048 },
    consumed,
  });
  const result = (value: unknown) => value as T;
  if (method === "GET") {
    if (path === "/api/v1/state/") return result(state());
    if (path === "/api/v1/chat/") return result({ turns });
    if (path === "/api/v1/received/") return result({ files: received });
    if (path === "/api/v1/credentials/") return result({ tokens: [] });
  }
  if (path === "/api/v1/logout/") return result({});
  if (path === "/api/v1/chat/")
    return result(chat(String(body.message || ""), (body.channel as Channel) || "in_app", body.choice as Choice));
  if (path === "/api/v1/files/search/") return result({ files: rank(String(body.query || "")) });
  if (path === "/api/v1/preferences/") {
    user = { ...user, ...(body as Partial<Workspace["user"]>) };
    return result({});
  }
  const classify = /^\/api\/v1\/documents\/([^/]+)\/classify\/$/.exec(path);
  if (classify) {
    files = files.map((f) =>
      f.document_id === classify[1]
        ? {
            ...f,
            matter_id: (body.matter_id as string) || undefined,
            matter: matters.find((m) => m.id === body.matter_id)?.name || "",
            document_type: String(body.document_type || f.document_type),
            sensitive: !!body.sensitive,
          }
        : f,
    );
    return result({});
  }
  throw new PreviewError("That action isn’t available in the sample preview.");
}

export function resetPreview() {
  turns = [];
  pending = null;
  counter = 0;
}
