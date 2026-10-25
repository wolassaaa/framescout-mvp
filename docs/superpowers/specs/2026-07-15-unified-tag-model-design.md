# Unified Tag Model Design

## Goal

Make every meaningful FrameScout state available as a categorized, searchable tag while preserving the existing photo fields as the only source of truth.

## Tag Layers

1. Content tags: existing AI and manual content tags, including subject, scene, object, action, color, composition, quality, and editorial tags.
2. AI workflow tags: analysis state, AI disposition, recommendation membership, recommendation rank, model evidence, and AI reasons.
3. Human workflow tags: human disposition and session selection state.
4. Asset organization tags: source folder, burst group, RAW mapping, source availability, and preview availability.
5. Technical tags: camera, lens, exposure, ISO, and capture date.

## Source Of Truth

`ReviewAsset.tags` continues to contain authored content tags. The other layers are derived from existing `ReviewAsset` fields at read time. No derived tag is written back to the source file, RAW file, proxy, or authored tag array.

## User Experience

The tag workspace presents every tag with a category and source marker. Category filters let users view content, AI workflow, human workflow, organization, or technical tags. Selecting a tag shows its matching photos and uses the shared session selection. Search matches localized label, raw tag key, and tag value.

The review inspector exposes the current asset's full derived tag set, grouped by layer. Grid search uses the same tag projection, so workflow and technical tags work there too.

## Export Policy

Content and manual tags remain eligible delivery keywords by default. AI workflow, human workflow, organization, and technical tags are retained in the project and available to export filters, but are excluded from delivery keywords by default. Export will show tag category and source so the user can explicitly include operational tags when needed.

## Constraints

- Source photos, RAW files, and XMP must not be changed during review.
- Keep existing `ReviewAsset` and project persistence compatibility.
- Use Chinese labels with English tag keys retained for search and export.
- Preserve the existing shared `gridSelection` workspace selection.

## Verification

- Unit tests prove a single asset projects content, AI, human, organization, and technical tags.
- Coverage view test proves a derived workflow tag can open the matching asset list.
- Grid test proves search matches a derived tag.
- Export test proves operational tags are available as filters but excluded from default delivery keywords.
