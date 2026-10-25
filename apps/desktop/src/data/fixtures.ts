import type { ProjectSummary, ReviewAsset } from "@framescout/contracts";

const demoPhoto = "/review-demo.jpg";

const photo = (id: string, a: string, b: string, c: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${a}"/>
          <stop offset="0.58" stop-color="${b}"/>
          <stop offset="1" stop-color="${c}"/>
        </linearGradient>
        <filter id="grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2"/>
          <feColorMatrix type="saturate" values="0"/>
          <feComponentTransfer><feFuncA type="table" tableValues="0 0.14"/></feComponentTransfer>
        </filter>
      </defs>
      <rect width="1200" height="800" fill="url(#sky)"/>
      <rect y="570" width="1200" height="230" fill="#080A0D" opacity="0.82"/>
      <path d="M80 628 C260 550 470 708 700 606 C880 528 1040 548 1160 622" fill="none" stroke="#DCE8FF" stroke-width="7" opacity="0.32"/>
      <circle cx="${id === "moto" ? 765 : 690}" cy="334" r="92" fill="#F3F5F7" opacity="0.18"/>
      <rect x="${id === "wide" ? 230 : 510}" y="248" width="128" height="268" rx="48" fill="#F3F5F7" opacity="0.72"/>
      <rect x="${id === "wide" ? 375 : 650}" y="334" width="190" height="82" rx="24" fill="#0B0D10" opacity="0.78"/>
      <rect x="70" y="68" width="320" height="42" rx="6" fill="#0B0D10" opacity="0.44"/>
      <rect width="1200" height="800" filter="url(#grain)" opacity="0.4"/>
    </svg>
  `)}`;

export const projects: ProjectSummary[] = [
  {
    id: "matchday-0726",
    name: "Friday night finals",
    preset: "matchday-story",
    sourceFolder: "D:/shoots/finals/jpegs",
    coverUrl: demoPhoto,
    reviewed: 1284,
    selected: 43,
    aiRejects: 316,
    total: 1960,
    lastOpened: "Today 00:42"
  },
  {
    id: "pit-wall",
    name: "Pit wall practice",
    preset: "motorsport",
    sourceFolder: "E:/motorsport/practice/previews",
    coverUrl: demoPhoto,
    reviewed: 410,
    selected: 18,
    aiRejects: 92,
    total: 875,
    lastOpened: "Yesterday 23:11"
  }
];

export const assets: ReviewAsset[] = [
  {
    id: "fs-001",
    fileName: "6D2_7421.CR2",
    sourcePath: "fixture/finals/6D2_7421.CR2",
    fileFingerprint: "fixture/finals/6D2_7421.CR2::fixture",
    missingState: "present",
    captureTime: "21:14:08",
    camera: "Canon EOS 6D Mark II",
    lens: "70-200mm f/2.8",
    exposure: "1/1000 f/2.8",
    iso: 12800,
    previewUrl: demoPhoto,
    aiDisposition: "keep",
    humanDisposition: "unseen",
    reasons: ["subject_is_sharp", "exposure_usable"],
    tags: ["player", "close", "finals"],
    groupId: "burst-74",
    evidence: [
      { label: "Subject focus", value: "sharp crop", confidence: 0.91, tone: "keep" },
      { label: "People", value: "2 detected", confidence: 0.88, tone: "neutral" },
      { label: "Exposure", value: "usable", confidence: 0.82, tone: "keep" }
    ]
  },
  {
    id: "fs-002",
    fileName: "6D2_7422.CR2",
    sourcePath: "fixture/finals/6D2_7422.CR2",
    fileFingerprint: "fixture/finals/6D2_7422.CR2::fixture",
    missingState: "present",
    captureTime: "21:14:09",
    camera: "Canon EOS 6D Mark II",
    lens: "70-200mm f/2.8",
    exposure: "1/1000 f/2.8",
    iso: 12800,
    previewUrl: demoPhoto,
    aiDisposition: "review",
    humanDisposition: "unseen",
    reasons: ["no_allowed_subject_preserved_by_matchday"],
    tags: ["venue", "wide", "needs-review"],
    groupId: "burst-74",
    evidence: [
      { label: "People", value: "none detected", confidence: 0.79, tone: "review" },
      { label: "Preset", value: "Matchday story preserves", tone: "review" },
      { label: "Exposure", value: "low light usable", confidence: 0.76, tone: "keep" }
    ]
  },
  {
    id: "fs-003",
    fileName: "6D2_7423.CR2",
    sourcePath: "fixture/finals/6D2_7423.CR2",
    fileFingerprint: "fixture/finals/6D2_7423.CR2::fixture",
    missingState: "present",
    captureTime: "21:14:10",
    camera: "Canon EOS 6D Mark II",
    lens: "70-200mm f/2.8",
    exposure: "1/640 f/2.8",
    iso: 16000,
    previewUrl: demoPhoto,
    aiDisposition: "reject",
    humanDisposition: "unseen",
    reasons: ["subject_out_of_focus"],
    tags: ["soft-focus", "ai-reject"],
    groupId: "burst-74",
    evidence: [
      { label: "Subject focus", value: "soft crop", confidence: 0.93, tone: "reject" },
      { label: "Global focus", value: "weak", confidence: 0.87, tone: "reject" },
      { label: "Exposure", value: "usable", confidence: 0.7, tone: "neutral" }
    ]
  }
];
