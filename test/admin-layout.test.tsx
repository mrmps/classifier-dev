import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Dashboard } from "../src/features/admin/dashboard";
import { adminFixture } from "./admin-fixture";

test("every analytics section and detail table is rendered together for browser Find", () => {
  const html = renderToStaticMarkup(
    <Dashboard data={adminFixture()} range="24h" />,
  );
  for (const section of [
    "Overview",
    "Reliability",
    "Cost &amp; models",
    "Adoption",
    "Dimensions",
  ]) {
    expect(html).toContain(`id="${section}"`);
  }
  for (const heading of [
    "Requests over time",
    "Classification decisions",
    "Server error rate",
    "Model economics",
    "Busiest classifiers",
    "Dimension outcomes",
  ]) {
    expect(html).toContain(`>${heading}</h2>`);
  }
  expect(html).toContain('href="#Cost%20%26%20models"');
  expect(html).toContain('href="#Dimensions"');
  expect(html).toContain("ls_9f3c7a8d");
  expect(html).toContain("gemini-2.5-flash");
  // Shared trends are shown once, not duplicated when formerly separate tabs coexist.
  expect(html.match(/>Accepted-request latency<\/h2>/g)).toHaveLength(1);
  expect(html.match(/>Upstream spend<\/h2>/g)).toHaveLength(1);
  expect(html).not.toContain("aria-pressed");
});

test("unavailable data keeps all sections and recovery messages on the page", () => {
  const data = adminFixture();
  data.unavailable = ["totals", "series", "performance", "byModel"];
  data.errors = ["AE 503"];
  const html = renderToStaticMarkup(<Dashboard data={data} range="7d" />);
  expect(html).toContain("Some analytics are unavailable.");
  expect(html).toContain("Refresh to retry this panel.");
  expect(html).toContain('id="Dimensions"');
  expect(html).toContain("Model economics");
});
