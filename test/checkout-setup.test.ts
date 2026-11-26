import { expect, test } from "bun:test";
import { chmod, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

test("custom checkout startup does not require the legacy shop", async () => {
  const directory = resolve("testdata/checkout-setup-unit");
  await rm(directory, { recursive: true, force: true });
  for (const path of ["test", "bin", "shop", "testdata/moneronode"]) await mkdir(`${directory}/${path}`, { recursive: true });
  await Bun.write(`${directory}/test/start-regtest.sh`, await Bun.file("test/start-regtest.sh").text());
  const stubs: Record<string, string> = {
    "bin/curl": '#!/bin/sh\ncase "$*" in *:18081/*) exit 0;; *) exit 1;; esac\n',
    "bin/bun": '#!/bin/sh\nprintf "legacy shop started" > "$START_MARKER"\n',
    "bin/sleep": "#!/bin/sh\nexit 0\n",
    "testdata/moneronode/monerod": "#!/bin/sh\nexit 0\n",
  };
  for (const [path, content] of Object.entries(stubs)) {
    await Bun.write(`${directory}/${path}`, content);
    await chmod(`${directory}/${path}`, 0o755);
  }
  const child = Bun.spawn(["bash", `${directory}/test/start-regtest.sh`], {
    env: { ...Bun.env, PATH: `${directory}/bin:${Bun.env.PATH}`, SHOP_ROOT: `${directory}/shop`,
      CHECKOUT_URL: "http://127.0.0.1:3006/newsession", SKIP_BRAVE: "1", START_MARKER: `${directory}/started-legacy` },
    stdout: Bun.file(`${directory}/stdout.log`), stderr: Bun.file(`${directory}/stderr.log`),
  });
  expect(await child.exited).toBe(0);
  expect(await Bun.file(`${directory}/started-legacy`).exists()).toBe(false);
});
