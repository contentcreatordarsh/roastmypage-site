import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createDnsSafetyChecker,
  installSafeRequestInterception
} from "../src/puppeteer.js";

function request(url, { navigation = false, frame = {} } = {}) {
  const calls = [];
  return {
    calls,
    url: () => url,
    isNavigationRequest: () => navigation,
    frame: () => frame,
    async abort(reason) {
      calls.push(["abort", reason]);
    },
    async continue() {
      calls.push(["continue"]);
    }
  };
}

function pageMock() {
  const mainFrame = {};
  let requestHandler;
  return {
    mainFrameObject: mainFrame,
    setRequestInterceptionCalls: [],
    async setRequestInterception(enabled) {
      this.setRequestInterceptionCalls.push(enabled);
    },
    on(event, handler) {
      assert.equal(event, "request");
      requestHandler = handler;
    },
    mainFrame: () => mainFrame,
    requestHandler: () => requestHandler
  };
}

test("DNS safety checker caches one lookup per protocol and hostname", async () => {
  let resolve4Calls = 0;
  let resolve6Calls = 0;
  const checker = createDnsSafetyChecker({
    async resolve4() {
      resolve4Calls++;
      return ["93.184.216.34"];
    },
    async resolve6() {
      resolve6Calls++;
      throw Object.assign(new Error("no data"), { code: "ENODATA" });
    }
  });

  assert.equal(await checker("https://public.example/a"), true);
  assert.equal(await checker("https://public.example/b"), true);
  assert.equal(resolve4Calls, 1);
  assert.equal(resolve6Calls, 1);
});

test("request interception awaits safety checks and blocks unsafe redirects", async () => {
  const page = pageMock();
  const safety = await installSafeRequestInterception(
    page,
    async (url) => !url.includes("private")
  );
  assert.deepEqual(page.setRequestInterceptionCalls, [true]);

  const publicRequest = request("https://public.example/app.js");
  const publicResult = page.requestHandler()(publicRequest);
  assert.ok(publicResult instanceof Promise);
  await publicResult;
  assert.deepEqual(publicRequest.calls, [["continue"]]);

  const redirectRequest = request("https://private.example/redirect", {
    navigation: true,
    frame: page.mainFrameObject
  });
  await page.requestHandler()(redirectRequest);
  assert.deepEqual(redirectRequest.calls, [["abort", "blockedbyclient"]]);
  assert.equal(safety.wasMainNavigationBlocked(), true);
});

test("request interception aborts unsafe subresources without flagging main navigation", async () => {
  const page = pageMock();
  const safety = await installSafeRequestInterception(page, async () => false);
  const subresource = request("https://private.example/image.png");

  await page.requestHandler()(subresource);

  assert.deepEqual(subresource.calls, [["abort", "blockedbyclient"]]);
  assert.equal(safety.wasMainNavigationBlocked(), false);
});
