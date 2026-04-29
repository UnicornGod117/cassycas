import asyncio
from playwright.async_api import async_playwright
import os

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        abs_path = os.path.abspath("cas-calculator (2).html")
        await page.goto(f"file://{abs_path}")
        await asyncio.sleep(2)

        print("Verifying Step 6: Normalise Degree Symbol")
        res = await page.evaluate("""() => dispatch("45° + 45°", "trig")""")
        print(f"45° + 45°: {res['plain']}")

        # 45 deg + 45 deg = 90 deg = 1.5707... rad
        success = "1.5707" in res['plain'] or "90 deg" in res['plain']
        print(f"Success: {success}")

        await browser.close()
        if not success:
            exit(1)

if __name__ == "__main__":
    asyncio.run(run())
