import { test, expect, type Page } from '@playwright/test';
async function editChannel(page:Page,name='OpenCode Go Personal'){await page.getByRole('article',{name,exact:true}).getByRole('button',{name:'编辑',exact:true}).click();}
test('built DSH browser bundle loads, filters, refreshes and exposes errors',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'AI Usage 用量中心'})).toBeVisible();
  await expect(page.locator('.aim-card')).toHaveCount(6);
  await expect(page.locator('.aim-lowest')).toContainText('43%');
  await expect(page.getByRole('progressbar').first()).toHaveAttribute('aria-valuenow','72');
  await expect(page.locator('.aim-card').filter({has:page.getByRole('heading',{name:'DeepSeek',exact:true})})).toContainText('18.42 USD');
  await page.getByRole('combobox').selectOption('antigravity');
  await expect(page.locator('.aim-card')).toHaveCount(1);
  await expect(page.locator('.aim-card')).toContainText('Claude / GPT · Weekly');
  await page.getByRole('button',{name:'↻ 刷新额度'}).click();
  await expect.poll(()=>page.evaluate(()=>window.refreshCount)).toBe(1);
  await page.evaluate(()=>{window.testFail=true;});
  await page.getByRole('button',{name:'↻ 刷新额度'}).click();
  await expect(page.getByRole('alert')).toContainText('无法连接额度服务');
  await expect(page.locator('.aim-card')).toHaveCount(1);
  expect(errors).toEqual([]);
});
test('desktop and narrow screens have no horizontal overflow',async({page})=>{
  for(const width of [1180,390]){
    await page.setViewportSize({width,height:1000});await page.goto('/');
    await expect(page.locator('.aim-card')).toHaveCount(6);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await page.screenshot({path:`test-results/dashboard-${width}.png`,fullPage:true});
  }
});

test('configuration wizard saves key and validates in one action', async ({page}) => {
  await page.goto('/');await page.getByRole('button',{name:'配置渠道',exact:true}).click();
  await expect(page.getByRole('heading',{name:'已有渠道'})).toBeVisible();
  await page.getByRole('button',{name:'＋ 新增渠道',exact:true}).click();
  await page.getByRole('button',{name:'开始配置 →',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'API Key / Token'})).not.toBeVisible();
  await page.getByLabel('渠道名称',{exact:true}).fill('Work account');
  await page.getByRole('button',{name:/^填写 API Key/}).click();
  await page.getByRole('button',{name:'下一步：连接配置 →',exact:true}).click();
  await page.getByLabel('API Key / Token',{exact:true}).fill('synthetic-test-secret');
  await page.getByRole('button',{name:'保存并验证连接',exact:true}).click();
  await expect(page.getByText('连接成功 · 找到 3 项指标')).toBeVisible();
  await page.getByRole('button',{name:'← 返回连接配置',exact:true}).click();
  await expect(page.getByLabel('API Key / Token',{exact:true})).toHaveValue('');
  await page.getByRole('button',{name:'AI 用量概览',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'额度与渠道'})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog',{name:'额度与渠道'})).not.toBeVisible();
});

test('hover preview is demand-driven, configuration pauses collection, and only visible details poll',async({page})=>{
  await page.clock.install();
  await page.goto('/?chip=1');
  const chip=page.getByRole('button',{name:'AI 用量概览',exact:true});
  await expect(chip).toBeVisible();
  await page.clock.fastForward(600000);
  expect(await page.evaluate(()=>window.queryCount)).toBe(0);
  await chip.hover();
  const preview=page.getByRole('region',{name:'用量总体预览'});
  await expect(preview).toBeVisible();
  await expect(preview.locator('.aim-preview-row')).toHaveCount(6);
  expect(await page.evaluate(()=>window.queryCount)).toBe(1);
  await page.clock.fastForward(300000);
  expect(await page.evaluate(()=>window.queryCount)).toBe(1);
  await preview.getByRole('button',{name:'配置渠道',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'额度与渠道'});
  await expect(dialog.getByRole('heading',{name:'已有渠道'})).toBeVisible();
  await expect(dialog.locator('.aim-card')).toHaveCount(0);
  await page.clock.fastForward(300000);
  expect(await page.evaluate(()=>window.queryCount)).toBe(1);
  await dialog.getByRole('button',{name:'用量详情',exact:true}).click();
  await expect(dialog.locator('.aim-card')).toHaveCount(6);
  expect(await page.evaluate(()=>window.queryCount)).toBe(2);
  await page.clock.fastForward(120000);
  await expect.poll(()=>page.evaluate(()=>window.queryCount)).toBe(3);
  expect(await page.evaluate(()=>window.refreshCount)).toBe(0);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
  await page.clock.fastForward(300000);
  expect(await page.evaluate(()=>window.queryCount)).toBe(3);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
  await expect.poll(()=>page.evaluate(()=>window.queryCount)).toBe(4);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(preview).not.toBeVisible();
  await page.clock.fastForward(300000);
  expect(await page.evaluate(()=>window.queryCount)).toBe(4);
});

test('compact preview fits a narrow viewport and keyboard users can reach detail actions',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/?chip=1');
  const chip=page.getByRole('button',{name:'AI 用量概览',exact:true});
  await chip.focus();
  const preview=page.getByRole('region',{name:'用量总体预览'});
  await expect(preview.locator('.aim-preview-row')).toHaveCount(6);
  await preview.screenshot({path:'test-results/preview-mobile.png'});
  const bounds=await preview.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(390);
  await page.keyboard.press('Tab');
  await expect(preview.getByRole('button',{name:'查看详情'})).toBeFocused();
  await page.keyboard.press('Enter');
  const dialog=page.getByRole('dialog',{name:'额度与渠道'});
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button',{name:'关闭',exact:true})).toBeFocused();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/compact-dialog-mobile.png'});
});

test('saved preview selections hide weekly, keep aliases, and leave detailed metrics intact',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'配置渠道',exact:true}).click();
  await editChannel(page);
  await page.getByRole('button',{name:'保存并验证连接',exact:true}).click();
  await page.getByRole('button',{name:'选择预览指标 →',exact:true}).click();
  await expect(page.getByRole('checkbox',{name:'Weekly',exact:true})).toBeVisible();
  await page.getByRole('checkbox',{name:'Weekly',exact:true}).uncheck();
  await page.locator('.aim-wizard-metric').filter({has:page.getByRole('checkbox',{name:'5h',exact:true})}).getByText('改名、排序与取值说明',{exact:true}).click();
  await page.getByLabel('指标别名 5h',{exact:true}).fill('短期');
  await page.getByRole('button',{name:'保存显示设置',exact:true}).click();
  await expect(page.getByText('已保存并生效')).toBeVisible();
  await page.getByRole('button',{name:'AI 用量概览',exact:true}).hover();
  const preview=page.getByRole('region',{name:'用量总体预览'});
  const row=preview.locator('.aim-preview-row').filter({hasText:'OpenCode Go'});
  await expect(row).toContainText(/短期\s*72%/);await expect(row).not.toContainText('Weekly');
  await preview.getByRole('button',{name:'查看详情',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'额度与渠道'});
  await expect(dialog.locator('.aim-card').filter({hasText:'OpenCode Go'})).toContainText('Weekly');
  await page.keyboard.press('Escape');
  await page.getByRole('checkbox',{name:'显示这个渠道',exact:true}).uncheck();
  await page.getByRole('button',{name:'保存显示设置',exact:true}).click();
  await expect(page.getByRole('button',{name:'保存显示设置',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'AI 用量概览',exact:true}).hover();
  await expect(preview.locator('.aim-preview-row')).toHaveCount(5);
  await expect(preview).not.toContainText('OpenCode Go');
});

test('CLI connection stays in its own step, discovery requires explicit addition',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'配置渠道',exact:true}).click();
  await editChannel(page,'Codex Personal');
  await page.getByRole('combobox',{name:'执行位置',exact:true}).selectOption('ssh');
  await page.getByLabel('SSH 主机',{exact:true}).fill('workstation');
  await page.getByText('查看查询方法与凭据来源',{exact:true}).click();
  await expect(page.locator('.aim-method')).toContainText('SSH 主机 workstation');
  await expect(page.locator('.aim-method')).toContainText('account/rateLimits/read');
  await page.getByRole('button',{name:'保存并验证连接',exact:true}).click();
  await expect(page.getByText('连接成功 · 找到 2 项指标')).toBeVisible();
  await page.getByRole('navigation',{name:'配置步骤'}).getByRole('button',{name:/账号与来源|选择渠道/}).click();
  await page.getByText('从本机发现其他已有登录',{exact:true}).click();
  await page.getByRole('button',{name:'发现本机来源',exact:true}).click();
  await page.getByRole('button',{name:'添加 Codex 本机来源',exact:true}).click();
  await expect(page.getByRole('button',{name:'← 返回渠道列表',exact:true})).toBeDisabled();
  await page.getByRole('navigation',{name:'配置步骤'}).getByRole('button',{name:/预览内容/}).click();
  await expect(page.getByRole('checkbox',{name:'显示这个渠道',exact:true})).not.toBeChecked();
  await page.getByRole('navigation',{name:'配置步骤'}).getByRole('button',{name:/账号与来源|选择渠道/}).click();
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/channel-config-mobile.png',fullPage:true});
});

test('OpenCode offers only implemented HTTP sources and stopped channels can be saved',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'配置渠道',exact:true}).click();
  await editChannel(page);
  await expect(page.getByRole('button',{name:/使用 CLI 登录/})).not.toBeVisible();
  await expect(page.getByText('当前通过 HTTP 接口查询 OpenCode Go',{exact:true})).toBeVisible();
  await expect(page.getByLabel('API Key / Token',{exact:true})).not.toBeVisible();
  await expect(page.locator('.aim-method')).not.toBeVisible();
  await page.getByText('查看查询方法与凭据来源',{exact:true}).click();
  await expect(page.locator('.aim-curl pre')).toContainText('https://opencode.ai/zen/go/v1/usage');
  await expect(page.locator('.aim-curl pre')).toContainText('${AI_METER_TOKEN}');
  await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text:string)=>{(window as unknown as {copiedCurl:string}).copiedCurl=text;}}});});
  await page.getByRole('button',{name:'复制 curl',exact:true}).click();
  await expect(page.getByRole('button',{name:'已复制 curl',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as unknown as {copiedCurl:string}).copiedCurl)).toContain('${AI_METER_TOKEN}');
  await page.getByRole('button',{name:'← 上一步',exact:true}).click();
  await page.getByRole('checkbox',{name:'启用此渠道',exact:true}).uncheck();
  await page.getByRole('button',{name:'保存停用设置',exact:true}).click();
  await expect(page.getByText('已保存并生效')).toBeVisible();
  await expect(page.getByRole('button',{name:'← 返回渠道列表',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'← 返回渠道列表',exact:true}).click();
  await expect(page.getByRole('article',{name:'OpenCode Go Personal',exact:true})).toContainText('已停用');
});

test('channel list is the default entry, supports toggling and cancelling a new channel',async({page})=>{
  await page.goto('/');
  await expect(page.locator('.aim-card').filter({hasText:'Kimi'})).toHaveCount(0);
  await expect(page.locator('.aim-card').filter({hasText:'302.AI'})).toContainText('网络请求失败');
  await page.getByRole('button',{name:'配置渠道',exact:true}).click();
  await expect(page.getByRole('heading',{name:'已有渠道'})).toBeVisible();
  await expect(page.getByRole('navigation',{name:'配置步骤'})).toHaveCount(0);
  const row=page.getByRole('article',{name:'OpenCode Go Personal',exact:true});
  await row.getByRole('button',{name:'停用',exact:true}).click();
  await expect(row).toContainText('已停用');
  await row.getByRole('button',{name:'启用',exact:true}).click();
  await expect(row).toContainText('在预览显示');
  await page.getByRole('button',{name:'＋ 新增渠道',exact:true}).click();
  await page.getByRole('combobox',{name:'新增渠道平台',exact:true}).selectOption('minimax');
  await page.getByRole('button',{name:'取消',exact:true}).click();
  await expect(page.locator('.aim-channel-item')).toHaveCount(7);
});

test('list validates inline and deletes only the confirmed channel',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'配置渠道',exact:true}).click();
  const row=page.getByRole('article',{name:'OpenCode Go Personal',exact:true});
  await row.getByRole('button',{name:'校验',exact:true}).click();
  await expect(row.getByRole('status')).toContainText('校验成功 · 3 项指标');
  await expect(page.getByRole('heading',{name:'已有渠道'})).toBeVisible();
  const failed=page.getByRole('article',{name:'302.AI Personal',exact:true});
  await failed.getByRole('button',{name:'校验',exact:true}).click();
  await expect(failed.getByRole('status')).toContainText('校验失败 · 网络连接失败');
  await row.getByRole('button',{name:'停用',exact:true}).click();
  await expect(row.getByRole('button',{name:'校验',exact:true})).toBeDisabled();
  await row.getByRole('button',{name:'删除',exact:true}).click();
  await expect(row).toContainText('保留已保存凭据');
  await row.getByRole('button',{name:'取消删除',exact:true}).click();
  await expect(row).toBeVisible();
  await row.getByRole('button',{name:'删除',exact:true}).click();
  await row.getByRole('button',{name:'确认删除',exact:true}).click();
  await expect(row).toHaveCount(0);
  await expect(failed).toBeVisible();
  await page.getByRole('button',{name:'用量详情',exact:true}).click();
  await page.getByRole('button',{name:'配置渠道',exact:true}).click();
  await expect(row).toHaveCount(0);
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/channel-list-mobile.png',fullPage:true});
});

test('Antigravity configuration uses official CLI and discovers official quota windows',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'配置渠道',exact:true}).click();
  await editChannel(page,'Antigravity Personal');
  await expect(page.getByText('通过官方 agy CLI 查询',{exact:true})).toBeVisible();
  await expect(page.locator('.aim-connection-note code')).toHaveText('agy --print /usage');
  await expect(page.getByText('第三方来源、兼容限制与可选安装',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'保存并验证连接',exact:true}).click();
  await expect(page.getByText('连接成功 · 找到 4 项指标',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'选择预览指标 →',exact:true}).click();
  await expect(page.getByRole('checkbox',{name:'Gemini · Weekly',exact:true})).toBeVisible();
  await expect(page.getByRole('checkbox',{name:'Claude / GPT · 5h',exact:true})).toBeVisible();
});

test('preview has remaining bars and visible reset dates; native modal covers host resize controls',async({page})=>{
  await page.goto('/?chip=1');
  await page.getByRole('button',{name:'AI 用量概览',exact:true}).hover();
  const preview=page.getByRole('region',{name:'用量总体预览'});
  const opencode=preview.locator('.aim-preview-row').filter({hasText:'OpenCode Go'});
  await expect(opencode.getByRole('progressbar',{name:'5h 剩余额度',exact:true})).toHaveAttribute('aria-valuenow','72');
  await expect(opencode.locator('time')).toBeVisible();
  await expect(opencode.locator('time')).toContainText(/20\d{2}/);
  await expect(opencode.locator('time')).toContainText('后');
  await expect(preview.locator('.aim-preview-row').filter({hasText:'DeepSeek'}).getByRole('progressbar')).toHaveCount(0);
  await preview.screenshot({path:'test-results/preview-bars-desktop.png'});
  await page.evaluate(()=>{const handle=document.createElement('div');handle.id='host-resize-handle';handle.style.cssText='position:fixed;inset:0;z-index:2147483647;background:red;pointer-events:auto';document.body.appendChild(handle);});
  // Launch programmatically because the deliberately hostile host control now covers the chip.
  await preview.getByRole('button',{name:'查看详情',exact:true}).evaluate((el:HTMLButtonElement)=>el.click());
  const modal=page.getByRole('dialog',{name:'额度与渠道'});
  await expect(modal).toBeVisible();
  expect(await modal.evaluate(el=>el.matches(':modal'))).toBe(true);
  const box=await modal.boundingBox();expect(box!.width).toBeGreaterThan(1100);
  expect(await modal.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.left+r.width/2,r.top+24));})).toBe(true);
  await modal.getByRole('button',{name:'配置渠道',exact:true}).click();
  await expect(modal.getByRole('heading',{name:'已有渠道'})).toBeVisible();
  await page.evaluate(()=>document.getElementById('host-resize-handle')?.remove());
  await modal.screenshot({path:'test-results/modal-wide.png'});
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
  expect(await page.evaluate(()=>document.body.style.overflow)).toBe('');
});
