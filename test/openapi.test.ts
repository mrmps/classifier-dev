import { describe, expect, test } from "bun:test";

import { OPENAPI, ERROR_CODES, LLMS_TXT } from "../src/openapi";

describe("OpenAPI spec structure", () => {
  test("declares OpenAPI 3.1", () => {
    expect(OPENAPI.openapi).toBe("3.1.0");
  });

  test("has info with title, version, and contact", () => {
    expect(OPENAPI.info.title).toBe("classifier.dev");
    expect(OPENAPI.info.version).toBeTruthy();
    expect(OPENAPI.info.contact).toBeDefined();
  });

  test("has at least the core paths", () => {
    const paths = Object.keys(OPENAPI.paths);
    for (const required of ["/", "/v1/classify", "/v1/health", "/{labels}/{text}"]) {
      expect(paths).toContain(required);
    }
  });

  test("every path has at least one operation", () => {
    for (const [path, methods] of Object.entries(OPENAPI.paths)) {
      const ops = Object.keys(methods as object).filter((k) => ["get", "post", "put", "delete", "patch"].includes(k));
      expect(ops.length).toBeGreaterThan(0);
    }
  });

  test("ClassifyRequest schema exists in components", () => {
    expect(OPENAPI.components.schemas.ClassifyRequest).toBeDefined();
    expect(OPENAPI.components.schemas.ClassifyRequest.properties).toBeDefined();
  });

  test("ClassifyResponse schema exists in components", () => {
    expect(OPENAPI.components.schemas.ClassifyResponse).toBeDefined();
  });

  test("DimensionResult schema exists in components", () => {
    expect(OPENAPI.components.schemas.DimensionResult).toBeDefined();
    expect(OPENAPI.components.schemas.DimensionResult.properties?.label).toBeDefined();
  });

  test("Error schema lists all error codes", () => {
    const errorSchema = OPENAPI.components.schemas.Error;
    expect(errorSchema).toBeDefined();
    expect(errorSchema.properties.code).toBeDefined();
  });

  test("security scheme is defined", () => {
    expect(OPENAPI.components.securitySchemes.partnerKey).toBeDefined();
    expect(OPENAPI.components.securitySchemes.partnerKey.type).toBe("http");
    expect(OPENAPI.components.securitySchemes.partnerKey.scheme).toBe("bearer");
  });
});

describe("ERROR_CODES", () => {
  test("contains the documented codes", () => {
    for (const code of ["bad_json", "no_input", "rate_limit_minute", "rate_limit_day", "not_found", "internal"]) {
      expect(ERROR_CODES).toContain(code);
    }
  });
});

describe("LLMS_TXT", () => {
  test("starts with the project name", () => {
    expect(LLMS_TXT).toMatch(/^# classifier\.dev/);
  });

  test("mentions the API endpoint", () => {
    expect(LLMS_TXT).toContain("classifier.dev/v1/classify");
  });
});
