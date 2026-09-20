const promises = {
  async resolve4() {
    return ["93.184.216.34"];
  },
  async resolve6() {
    throw Object.assign(new Error("no IPv6 data"), { code: "ENODATA" });
  }
};

export default { promises };
