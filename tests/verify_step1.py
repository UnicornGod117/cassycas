import asyncio
from playwright.async_api import async_playwright
import os

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        abs_path = os.path.abspath("CAS (new).html")
        await page.goto(f"file://{abs_path}")
        await asyncio.sleep(2)

        print("Verifying Step 1: Symbolic Quadratic Solver")
        # x^2 - 5x + 6 = 0  => roots 2, 3
        # a=1, b=-5, c=6
        # f''(x) = 2 = aS
        # f'(x) = 2x - 5
        # bS = (2x-5) - 2*x = -5
        # cS = 6
        # disc = (-5)^2 - 2*2*6 = 25 - 24 = 1
        # roots = (5 +/- 1) / 2 = 3, 2
        result = await page.evaluate("""() => {
            return dispatch("solve(x^2 - 5x + 6 = 0, x)", "solve");
        }""")
        print(f"Result plain: {result['plain']}")
        # It might be "(3) or (2)" or similar depending on math.simplify
        success = "3" in result['plain'] and "2" in result['plain']
        print(f"Success: {success}")

        await browser.close()
        if not success:
            exit(1)

if __name__ == "__main__":
    asyncio.run(run())
