# Clips belong to the source, and an edit's keeps do not

## What is wrong

`v2_clips` has `source_id` and no `project_id`. The `kept` flag lives on the
clip row. So every edit of the same video reads and writes ONE set of clips and
ONE keep/drop state.

The owner hit all three symptoms without knowing the cause:

- "every time i click into the video it seems to make a new edit" — four
  projects on one source, each rendering the same eleven clips, each reporting
  "11 clips kept · 5:00 so far". Not four coincidences. One shared set counted
  four times.
- "i never asked it to edit anything" — opening a video showed scored blocks
  with a model's reasons on them, left behind by an earlier briefed edit.
- Keeping a clip in one edit silently changed another.

## Why the shape is half right

The clip library IS source-scoped, correctly: Footage's Clips tab is a library
of moments across all your footage, each block says "Saved to Footage →", and
dedupe-on-overlap in `saveClips` exists precisely so a second pass does not
fill that library with near-identical rows. That is a library, and a library
belongs to the footage.

What does not belong to the footage is *which of those moments this edit keeps,
and in what order*. That is the edit. It belongs on the project, next to
`cuts`, which already works exactly this way — a project's `cuts` are the
project's own and two edits of one transcript do not collide.

## The fix, when it is done

Move keep/drop and ordering off the clip row and onto the project, as a
`kept_clips` array of clip ids in order — the same shape and the same
discipline as `cuts`. `v2_clips.kept` then goes away entirely, `setKept`
becomes a project write, and Pick renders the library filtered by the
project's own list.

## What is fixed now, and what is not

Fixed: an edit with no brief runs no pass, owns no clips, and renders the
transcript. It cannot inherit another edit's scored blocks. Opening a video
twice reuses one edit rather than breeding them, and only reuses an
edit that was also opened without a brief.

Not fixed: two BRIEFED edits of the same source still share one `kept` flag.
Rarer now that opening no longer duplicates, but still wrong.
