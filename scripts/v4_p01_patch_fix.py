from pathlib import Path

path = Path('scripts/v4_p01_patch.py')
text = path.read_text(encoding='utf-8')
old = '''replace_once("src/components/reconciliation/Bill360Drawer.jsx", "onChanged={loadContractCheck}", "onChanged={refreshContractCheck}", "carry forward refresh")
replace_once("src/components/reconciliation/Bill360Drawer.jsx", "onChanged={loadContractCheck}", "onChanged={refreshContractCheck}", "difference refresh")'''
new = '''drawer_path = Path("src/components/reconciliation/Bill360Drawer.jsx")
drawer_text = drawer_path.read_text(encoding="utf-8")
callback_target = "onChanged={loadContractCheck}"
if drawer_text.count(callback_target) != 2:
    raise SystemExit(f"contract refresh callbacks: expected 2 targets, found {drawer_text.count(callback_target)}")
drawer_path.write_text(drawer_text.replace(callback_target, "onChanged={refreshContractCheck}", 2), encoding="utf-8")'''
if old not in text:
    raise SystemExit('temporary patch callback block not found')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
