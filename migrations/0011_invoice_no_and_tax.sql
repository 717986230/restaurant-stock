-- 单据编号 + 税额拆分。
--
-- 为什么要拆三个金额：欧洲发票的明细列是「净额」（不含税），
-- 而实际付给供应商的是含税总额。之前把明细一加当作单据总额，
-- 每张单都会少算一个税额（奥地利食材 4.9%/10%/20% 三档混在一张单上，
-- 差额能到 10%），结账导出给会计的数是错的。
--
-- 三个金额一律以单据上印的为准，不从明细反算：各档税额分别四舍五入，
-- 净额加税额未必等于单据上的总计（差一两分钱是常态），
-- 而付款要照着单据付。明细只用来核对「货对不对」，不用来算「付多少」。

alter table receiving_slips add column invoice_no text;
alter table receiving_slips add column net_amount real;
alter table receiving_slips add column tax_amount real;
alter table receiving_slips add column gross_amount real;

-- 查重用：同一账号下按编号找已有单据
create index idx_receiving_slips_invoice_no on receiving_slips (user_id, invoice_no);
