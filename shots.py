"""Screenshot the Pluck UI flow (home -> result -> download). Run with a python
that has playwright (the Mythos venv has it). Requires the server on :8000."""
import asyncio, os
from playwright.async_api import async_playwright

OUT = os.path.join(os.path.dirname(__file__), "screenshots")
os.makedirs(OUT, exist_ok=True)
APP = "http://localhost:8000"


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--no-sandbox"])
        page = await (await b.new_context(viewport={"width": 1100, "height": 900})).new_page()

        await page.goto(APP, wait_until="load")
        await page.wait_for_timeout(900)  # fonts
        await page.screenshot(path=f"{OUT}/grab-01-home.png", full_page=True)
        print("saved home")

        # fetch info via the example button
        await page.click('.ex[data-url*="aqz-KE-bpKQ"]')
        await page.wait_for_selector("#result:not(.hidden)", timeout=45000)
        await page.wait_for_timeout(1200)
        await page.screenshot(path=f"{OUT}/grab-02-result.png", full_page=True)
        print("saved result")

        # pick 360p and download
        for chip in await page.query_selector_all(".q-chip"):
            if (await chip.inner_text()).startswith("360"):
                await chip.click(); break
        await page.click("#downloadBtn")
        await page.wait_for_selector(".job", timeout=10000)
        # let it progress / finish
        try:
            await page.wait_for_selector(".chip-done", timeout=40000)
        except Exception:
            pass
        await page.wait_for_timeout(600)
        await page.screenshot(path=f"{OUT}/grab-03-download.png", full_page=True)
        print("saved download")

        await b.close()
        print("DONE")


asyncio.run(main())
