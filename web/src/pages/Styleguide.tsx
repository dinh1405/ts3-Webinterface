import { useState } from 'react';
import { Archive, Info, Pencil, Plus, RefreshCw, Trash2, Users } from 'lucide-react';
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, Field, IconButton, KV, Menu, PageHeader, Skeleton, SortableTh, Sparkline, StatTile, StatusText, TabBar, Tip, Toggle, TONES, invalid } from '../components/ui';

/*
 * Developer style guide (dev build only, route /styleguide): every building block of the design system with
 * its variants and states, so changes can be reviewed on one page. Texts are intentionally English literals.
 */
const spark = [3, 4, 4, 5, 6, 5, 7, 8, 8, 9, 11, 10, 12];

export default function StyleguidePage() {
  const [tab, setTab] = useState<'a' | 'b' | 'c'>('a');
  const [on, setOn] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' });
  return (
    <div className="space-y-6">
      <PageHeader title="Style guide" description="Design system 1.8.0 – tokens, components, states. Development build only." actions={<><Button variant="ghost" icon={RefreshCw}>Ghost</Button><Button icon={Plus}>Secondary</Button><Button variant="primary" icon={Plus}>Primary</Button></>} />

      <Card title="Tones" subtitle="One semantic vocabulary for Badge, Alert, StatusText and tiles">
        <div className="flex flex-wrap gap-2">{TONES.map((tn) => <Badge key={tn} tone={tn} dot>{tn}</Badge>)}</div>
        <div className="mt-3 flex flex-wrap gap-4 text-sm">{TONES.map((tn) => <StatusText key={tn} tone={tn} dot>{tn}</StatusText>)}</div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Alert tone="info" title="Info">Neutral information with a title and body text.</Alert>
        <Alert tone="success" title="Success">The operation completed.</Alert>
        <Alert tone="warning">Warning without title – a single line.</Alert>
        <Alert tone="danger" title="Error" action={<Button size="sm" variant="ghost">Retry</Button>}>Something failed; the action slot sits on the right.</Alert>
        <Alert tone="accent" compact spinning icon={RefreshCw}>Compact, spinning icon – running operation.</Alert>
        <Alert tone="neutral" compact>Compact neutral hint.</Alert>
      </div>

      <Card title="Buttons">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary">Primary</Button><Button>Secondary</Button><Button variant="ghost">Ghost</Button><Button variant="danger">Danger</Button><Button variant="success">Success</Button><Button variant="warning">Warning</Button>
          <Button variant="primary" loading>Loading</Button><Button disabled>Disabled</Button>
          <Button size="sm" variant="primary" icon={Plus}>Small</Button><Button size="sm" icon={Pencil}>Small</Button>
          <IconButton label="Edit" icon={Pencil} size="sm" variant="ghost" /><IconButton label="Delete" icon={Trash2} size="sm" variant="ghost" /><IconButton label="Info" icon={Info} />
          <Menu trigger={<Button>Menu</Button>} items={[{ label: 'Edit', icon: Pencil, onSelect: () => {} }, { label: 'Archive', icon: Archive, onSelect: () => {} }, { type: 'separator' }, { label: 'Delete', icon: Trash2, onSelect: () => {}, danger: true }]} />
          <Tip content="Tooltip on hover and focus"><Button variant="ghost">Tooltip</Button></Tip>
          <Button variant="danger" onClick={() => setConfirm(true)}>Confirm dialog</Button>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Clients online" value="6" unit="/ 64" icon={Users} tone="accent" trend={{ text: '+2 · 1 h', tone: 'success' }} spark={spark} />
        <StatTile label="Bandwidth" value="39.5" unit="KB/s" tone="info" trend={{ text: 'stable' }} spark={[...spark].reverse()} />
        <StatTile label="Ping" value="23.4" unit="ms" tone="success" trend={{ text: '−1.2 ms', tone: 'success' }} spark={spark.map((v) => 20 - v)} />
        <StatTile label="Channels" value="9" sub="3 in use · 0.12 % loss" tone="purple" trend={{ text: '9 active' }} />
      </div>

      <Card title="Forms">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Name" hint="Helper text below the field"><input className="input" placeholder="Placeholder" /></Field>
          <Field label="With error" error="This value is required"><input className="input" defaultValue="" {...invalid(true)} /></Field>
          <Field label="Select"><select className="input"><option>Option A</option><option>Option B</option></select></Field>
          <Field label="Disabled"><input className="input" disabled defaultValue="read-only" /></Field>
          <Toggle checked={on} onChange={setOn} label="Toggle" description="With description" />
          <Toggle checked={false} onChange={() => {}} label="Disabled" disabled />
        </div>
      </Card>

      <div>
        <TabBar value={tab} onChange={setTab} items={[{ value: 'a', label: 'First', icon: Users }, { value: 'b', label: 'Second', icon: Archive, badge: <Badge tone="accent">3</Badge> }, { value: 'c', label: 'Third' }]} label="Example tabs" />
        <Card noPadding>
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr>
                <SortableTh label="Name" active={sort.key === 'name'} dir={sort.dir} onSort={() => setSort((s) => ({ key: 'name', dir: s.key === 'name' && s.dir === 'asc' ? 'desc' : 'asc' }))} />
                <SortableTh label="Size" active={sort.key === 'size'} dir={sort.dir} onSort={() => setSort((s) => ({ key: 'size', dir: s.key === 'size' && s.dir === 'asc' ? 'desc' : 'asc' }))} align="right" className="text-right" />
                <th>Status</th>
              </tr></thead>
              <tbody>
                <tr><td>alpha</td><td className="text-right tabular-nums">12.4 MB</td><td><Badge tone="success" dot>ok</Badge></td></tr>
                <tr><td>beta</td><td className="text-right tabular-nums">1.1 MB</td><td><Badge tone="warning" dot>pending</Badge></td></tr>
                <tr><td>gamma</td><td className="text-right tabular-nums">0.3 MB</td><td><Badge tone="danger" dot>failed</Badge></td></tr>
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Skeleton"><Skeleton className="mb-3 h-4 w-40" /><Skeleton lines={4} /></Card>
        <Card title="Empty state" noPadding><EmptyState icon={Archive} title="Nothing here yet" description="Descriptions stay short and point to the next step." action={<Button variant="primary" size="sm" icon={Plus}>Create</Button>} /></Card>
      </div>

      <Card title="Key/value list"><KV items={[{ k: 'Name', v: 'Example Community' }, { k: 'Port', v: '9987' }, { k: 'Status', v: <Badge tone="success" dot>online</Badge> }, { k: 'Ping', v: '23.4 ms' }]} /></Card>
      <Card title="Sparkline"><div className="flex flex-wrap gap-6">{TONES.map((tn) => <Sparkline key={tn} values={spark} tone={tn} />)}</div></Card>

      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={() => setConfirm(false)} title="Delete item?" message="This cannot be undone." requireText="DELETE" />
    </div>
  );
}
