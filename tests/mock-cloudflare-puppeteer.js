let signals = {
  title: "Just a moment...",
  bodyTextLength: 0,
  markers: {}
};
let status = 403;
let launches = 0;

function configureChallenge(nextSignals, nextStatus) {
  signals = nextSignals;
  status = nextStatus;
}

function browserLaunches() {
  return launches;
}

const puppeteer = {
  async launch() {
    launches += 1;
    const page = {
      async setViewport() {},
      async setUserAgent() {},
      async setRequestInterception() {},
      on() {},
      async goto() {
        return { status: () => status };
      },
      url() {
        return "https://attacker.example/";
      },
      async evaluate() {
        return signals;
      },
      async setExtraHTTPHeaders() {},
      async reload() {
        return { status: () => status };
      }
    };
    return {
      async newPage() {
        return page;
      },
      async close() {}
    };
  }
};

export { configureChallenge, browserLaunches };
export default puppeteer;
