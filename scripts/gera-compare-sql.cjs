const fs = require('fs');
const plan = JSON.parse(fs.readFileSync('scripts/planilha-aberto.json', 'utf8'));
const esc = (s) => s.replace(/'/g, "''");
const values = Object.entries(plan)
  .map(([nome, v]) => `('${esc(nome)}',${v.toFixed(2)})`)
  .join(',\n');

const sql = `create temp table _plan(nome text, aberto numeric);
insert into _plan values
${values};

with gc as (
  select lower(regexp_replace(translate(s.name,'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ','aaaaaeeeeiiiiooooouuuucaaaaaeeeeiiiiooooouuuuc'),'\\\\s+',' ','g')) as nome,
    round(sum((i->>'value')::numeric),2) as aberto
  from public.students s
  cross join jsonb_array_elements(s.installments) i
  where s.company_id = (select id from public.companies where slug='iam')
    and coalesce(s.status_cancelamento,'nenhum') <> 'cancelado'
    and not (coalesce(s.is_renda_extra,false) and coalesce(s.renda_extra_status,'') not in ('','Conciliar Exclusão'))
    and (s.iam_control_aluno_id is null or s.iam_gc_conciliado_at is not null)
    and not (i->>'paid')::boolean
  group by 1
)
select coalesce(g.nome, p.nome) as nome,
  coalesce(g.aberto,0) as gc,
  coalesce(p.aberto,0) as planilha,
  round(coalesce(g.aberto,0) - coalesce(p.aberto,0), 2) as diff
from gc g
full join _plan p on p.nome = g.nome
where abs(coalesce(g.aberto,0) - coalesce(p.aberto,0)) > 0.01
order by abs(coalesce(g.aberto,0) - coalesce(p.aberto,0)) desc;
`;
fs.writeFileSync('scripts/compare.sql', sql);
console.log('sql gerado:', sql.length, 'chars,', Object.keys(plan).length, 'pessoas');
