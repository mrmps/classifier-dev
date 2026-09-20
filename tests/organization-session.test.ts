import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

test("organization switching refreshes AuthKit and preserves both cookies", () => {
  const result = spawnSync(process.execPath, ["-e", `
    import { mock } from "bun:test";
    import { strict as assert } from "node:assert";
    const cookies = new Map(); const events = [];
    mock.module("@tanstack/react-start", () => ({ createServerFn: () => ({validator(){return this},handler(fn){return fn}}) }));
    mock.module("cloudflare:workers", () => ({env:{APP_DB:{}}}));
    mock.module("@tanstack/react-start/server", () => ({
      getRequest: () => new Request("https://classifier.dev/_server", {headers:{Origin:"https://classifier.dev"}}),
      setResponseHeader: (name) => { assert.notEqual(name,"Set-Cookie"); },
      setCookie: (name,value) => cookies.set(name,value)
    }));
    mock.module("./src/server/auth", () => ({requireAccount:async()=>"workos:user_owner",assertSameOrigin:()=>{}}));
    mock.module("./src/server/organizations", () => ({
      selectedWorkspace:()=>undefined,
      performOrganizationAction:async()=>({active:{id:"workos:org_test",kind:"organization"}})
    }));
    mock.module("@workos/authkit-tanstack-react-start", () => ({switchToOrganization:async({data})=>{
      events.push(data.organizationId);cookies.set("wos-session","refreshed");
    }}));
    const { organizationAction } = await import("./src/features/organizations/organizations.functions");
    await organizationAction({data:{type:"switch",workspaceId:"workos:org_test"}});
    assert.deepEqual(events,["org_test"]);
    assert.equal(cookies.get("wos-session"),"refreshed");
    assert.equal(cookies.get("classifier_workspace"),"workos:org_test");
  `], { cwd: new URL("../", import.meta.url), encoding: "utf8" });
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
});
