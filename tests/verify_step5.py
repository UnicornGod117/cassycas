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

        print("Verifying Step 5: Angle Mode (Deg)")
        await page.evaluate("toggleAngle()") # rad -> deg

        # sin(90) -> 1
        res1 = await page.evaluate("""() => dispatch("sin(90)", "trig")""")
        print(f"sin(90) deg: {res1['plain']}")

        # asin(1) -> 90
        res2 = await page.evaluate("""() => dispatch("asin(1)", "trig")""")
        print(f"asin(1) deg: {res2['plain']}")

        # sinh(1) -> should NOT be affected
        res3 = await page.evaluate("""() => dispatch("sinh(1)", "trig")""")
        print(f"sinh(1) deg: {res3['plain']}")

        success = "1" in res1['plain'] and "90" in res2['plain'] and "1.175" in res3['plain']
        print(f"Success: {success}")

        await browser.close()
        if not success:
            exit(1)

if __name__ == "__main__":
    asyncio.run(run())
