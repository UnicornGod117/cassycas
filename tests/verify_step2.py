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

        print("Final check for solve(x - 1000 = 0, x)")
        result = await page.evaluate("""() => {
            return dispatch("solve(x - 1000 = 0, x)", "solve");
        }""")
        print(f"Result plain: {result['plain']}")
        success = "1000" in result['plain']
        print(f"Success: {success}")

        await browser.close()
        if not success:
            exit(1)

if __name__ == "__main__":
    asyncio.run(run())
