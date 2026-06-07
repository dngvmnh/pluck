"""Screenshot Pluck-on-Mythos: not-launched gate, authenticated, metered download,
out-of-credits, top-up. Run with the Mythos venv python (has playwright). Servers on 4000/8000."""
import asyncio, os, httpx
from playwright.async_api import async_playwright

B, G = "http://localhost:4000", "http://localhost:8000"
OUT = os.path.join(os.path.dirname(__file__), "screenshots")
os.makedirs(OUT, exist_ok=True)
USER = "user-pluck-001"


def set_balance(target):
    bal = httpx.get(f"{B}/api/wallet/{USER}").json()["balance"]
    if bal < target:
        httpx.post(f"{B}/api/wallet/topup", json={"userId": USER, "amount": target - bal})
    elif bal > target:
        jti = httpx.post(f"{B}/__mint", json={"sub": USER}).json()["jti"]
        httpx.post(f"{B}/api/apps/sessions/{jti}/meter", json={"credits": bal - target, "reason": "reset"})


async def main():
    set_balance(10)
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--no-sandbox"])

        ctx0 = await b.new_context(viewport={"width": 1100, "height": 820})
        pg = await ctx0.new_page()
        await pg.goto(G + "/", wait_until="load"); await pg.wait_for_timeout(500)
        await pg.screenshot(path=f"{OUT}/pluck-01-not-launched.png", full_page=True)
        await ctx0.close()
        print("saved 01 not-launched")

        ctx = await b.new_context(viewport={"width": 1100, "height": 820})
        page = await ctx.new_page()
        await page.goto(B + "/open/pluck", wait_until="load"); await page.wait_for_timeout(800)
        await page.screenshot(path=f"{OUT}/pluck-02-authenticated.png", full_page=True)
        print("saved 02 authenticated")

        await page.click('.ex[data-url*="aqz"]')
        await page.wait_for_selector("#result:not(.hidden)", timeout=45000); await page.wait_for_timeout(800)
        await page.screenshot(path=f"{OUT}/pluck-03-result.png", full_page=True)
        print("saved 03 result (cost note)")

        set_balance(1)                                  # drain so the next download can't be afforded
        await page.goto(G + "/", wait_until="load"); await page.wait_for_timeout(500)
        await page.click('.ex[data-url*="aqz"]')
        await page.wait_for_selector("#result:not(.hidden)", timeout=45000)
        async with page.expect_response(lambda r: "/api/download" in r.url):
            await page.click("#downloadBtn")
        await page.wait_for_timeout(800)
        await page.screenshot(path=f"{OUT}/pluck-04-insufficient.png", full_page=True)
        print("saved 04 insufficient")

        await page.click("#topupBtn"); await page.wait_for_timeout(700)
        await page.screenshot(path=f"{OUT}/pluck-05-toppedup.png", full_page=True)
        print("saved 05 topped-up")

        await b.close()
        print("DONE")


asyncio.run(main())
