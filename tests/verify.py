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

        print("Test: solve(x - 1000 = 0, x)")
        result = await page.evaluate("""() => {
            return dispatch("solve(x - 1000 = 0, x)", "solve");
        }""")
        print(f"Result: {result['plain']}")

        print("\nTest: Degree mode with functions")
        await page.evaluate("toggleAngle()") # Switch to Deg
        await page.evaluate("""() => dispatch("f(x) = sin(x)", "algebra")""")
        result = await page.evaluate("""() => dispatch("f(90)", "algebra")""")
        print(f"f(90) in Deg mode: {result['plain']}")

        print("\nTest: Degree mode direct")
        result = await page.evaluate("""() => dispatch("sin(90)", "trig")""")
        print(f"sin(90) in Deg mode: {result['plain']}")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(run())
