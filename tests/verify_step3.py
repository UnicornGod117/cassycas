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

        print("Verifying Step 3: Exact Mode")
        # exactMode is true by default
        latex1 = await page.evaluate("""() => applyExactMode("1/2 + 1/3", "")""")
        print(f"1/2 + 1/3 (exact): {latex1}")

        await page.evaluate("toggleExact()") # exactMode -> false (Approx)
        latex2 = await page.evaluate("""() => applyExactMode("1/2 + 1/3", "")""")
        print(f"1/2 + 1/3 (approx): {latex2}")

        success = "5" in latex1 and "6" in latex1 and "frac" in latex1 and "0.8333" in latex2
        print(f"Success: {success}")

        await browser.close()
        if not success:
            exit(1)

if __name__ == "__main__":
    asyncio.run(run())
