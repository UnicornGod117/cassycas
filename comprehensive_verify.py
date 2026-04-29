import asyncio
from playwright.async_api import async_playwright
import os
import re

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        abs_path = os.path.abspath("cas-calculator (2).html")
        await page.goto(f"file://{abs_path}")
        await asyncio.sleep(2)

        print("Running Comprehensive Verification...")

        # 1. Quadratic Solver
        res1 = await page.evaluate("""() => dispatch("solve(x^2 - 5x + a = 0, x)", "solve")""")
        success1 = "25" in res1['plain'] and "4 * a" in res1['plain']
        print(f"1. Quadratic Solver: {success1} ({res1['plain']})")

        # 2. findRoots Range
        res2 = await page.evaluate("""() => dispatch("solve(x - 1000 = 0, x)", "solve")""")
        success2 = "1000" in res2['plain']
        print(f"2. findRoots Range: {success2} ({res2['plain']})")

        # 3. Exact Mode
        latex3_exact = await page.evaluate("""() => applyExactMode("1/2 + 1/3", "")""")
        await page.evaluate("toggleExact()")
        latex3_approx = await page.evaluate("""() => applyExactMode("1/2 + 1/3", "")""")
        success3 = "5" in latex3_exact and "6" in latex3_exact and "0.833" in latex3_approx
        print(f"3. Exact Mode: {success3} (Exact: {latex3_exact}, Approx: {latex3_approx})")

        # 4. Angle Mode
        await page.evaluate("toggleAngle()") # to Deg
        res4_sin = await page.evaluate("""() => dispatch("sin(90)", "trig")""")
        res4_asin = await page.evaluate("""() => dispatch("asin(1)", "trig")""")
        success4 = "1" in res4_sin['plain'] and "90" in res4_asin['plain']
        print(f"4. Angle Mode: {success4} (sin(90)={res4_sin['plain']}, asin(1)={res4_asin['plain']})")

        # 5. Normalise
        res5 = await page.evaluate("""() => dispatch("30° + 30°", "trig")""")
        success5 = "60" in res5['plain'] or "59.9999999" in res5['plain']
        print(f"5. Normalise: {success5} ({res5['plain']})")

        all_success = all([success1, success2, success3, success4, success5])
        print(f"\nOverall Success: {all_success}")

        await browser.close()
        if not all_success:
            exit(1)

if __name__ == "__main__":
    asyncio.run(run())
