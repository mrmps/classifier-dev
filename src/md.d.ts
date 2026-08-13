// Markdown is bundled as a Text module (see the [[rules]] block in wrangler.toml),
// which keeps SKILL.md a real file instead of a string literal with escaped fences.
declare module "*.md" {
  const content: string;
  export default content;
}
