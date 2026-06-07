import asyncio, os
from playwright.async_api import async_playwright
OUT = os.path.join(os.path.dirname(__file__), "screenshots"); os.makedirs(OUT, exist_ok=True)
B, G = "http://localhost:4000", "http://localhost:8000"
PLAYLIST = "https://www.youtube.com/playlist?list=PL590L5WQmH8dpP0RyH5pCfIaDEdt9nk7r"


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--no-sandbox"])
        page = await (await b.new_context(viewport={"width": 1000, "height": 1000})).new_page()
        errs = []
        page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errs.append(str(e)))

        await page.goto(B + "/open/pluck", wait_until="load")
        await page.wait_for_timeout(700)
        await page.click('.ex[data-url*="aqz"]')
        await page.wait_for_selector("#result:not(.hidden)", timeout=45000)
        await page.click("#adv summary")
        await page.fill("#trimStart", "1:30")
        await page.fill("#trimEnd", "2:15")
        await page.check("#optMusic")
        await page.check("#optSponsor")
        await page.wait_for_timeout(400)
        await page.screenshot(path=f"{OUT}/pluck-adv-options.png", full_page=True)
        print("saved adv; download button:", (await page.inner_text("#downloadBtn")).strip())

        await page.fill("#url", PLAYLIST)
        await page.eval_on_selector("#search", "f => f.requestSubmit()")
        await page.wait_for_selector("#playlist:not(.hidden)", timeout=45000)
        await page.fill("#plKw", "real")
        await page.wait_for_timeout(400)
        await page.screenshot(path=f"{OUT}/pluck-playlist.png", full_page=True)
        print("saved playlist; title:", (await page.inner_text("#pl-title")).strip())
        print("JS errors:", errs[:5] if errs else "none")
        await b.close()


asyncio.run(main())
