import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDb } from '../db/client'
import { authenticate } from '../middleware/auth'
import { logAudit } from '../utils/audit'
import { checkConflict, runRulesOnAllTransactions, runSingleRule, type ConditionLogic } from '../services/rules'

const conditionSchema = z.object({
  field: z.enum(['date', 'account', 'payee', 'description', 'category', 'amount']),
  operator: z.enum(['is', 'is_not', 'contains', 'starts_with', 'ends_with']),
  value: z.string(),
})

const actionSchema = z.object({
  field: z.enum(['date', 'account', 'payee', 'description', 'category', 'amount']),
  value: z.string(),
})

const ruleBodySchema = z.object({
  name: z.string().min(1).max(256),
  groupId: z.number().int(),
  conditionLogic: z.enum(['AND', 'OR']).default('AND'),
  isEnabled: z.boolean().default(true),
  conditions: z.array(conditionSchema).min(1),
  actions: z.array(actionSchema).min(1),
})

export async function ruleRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/rules — all groups with nested rules, conditions, actions
  app.get('/api/rules', { preHandler: authenticate }, async (_request, reply) => {
    const db = getDb()

    const groups = db
      .prepare(`SELECT id, name, sort_order FROM rule_groups ORDER BY sort_order, id`)
      .all() as Array<{ id: number; name: string; sort_order: number }>

    const rules = db
      .prepare(
        `SELECT id, group_id, name, condition_logic, is_enabled, sort_order
         FROM rules ORDER BY sort_order, id`,
      )
      .all() as Array<{
      id: number
      group_id: number
      name: string
      condition_logic: string
      is_enabled: number
      sort_order: number
    }>

    if (rules.length === 0) {
      return reply.send(groups.map((g) => ({ ...g, rules: [] })))
    }

    const ruleIds = rules.map((r) => r.id)
    const placeholders = ruleIds.map(() => '?').join(',')

    const conditions = db
      .prepare(
        `SELECT id, rule_id, field, operator, value FROM rule_conditions
         WHERE rule_id IN (${placeholders}) ORDER BY id`,
      )
      .all(...ruleIds) as Array<{
      id: number
      rule_id: number
      field: string
      operator: string
      value: string
    }>

    const actions = db
      .prepare(
        `SELECT id, rule_id, field, value FROM rule_actions
         WHERE rule_id IN (${placeholders}) ORDER BY id`,
      )
      .all(...ruleIds) as Array<{ id: number; rule_id: number; field: string; value: string }>

    const condsByRule = new Map<number, typeof conditions>()
    for (const c of conditions) {
      const arr = condsByRule.get(c.rule_id) ?? []
      arr.push(c)
      condsByRule.set(c.rule_id, arr)
    }

    const actionsByRule = new Map<number, typeof actions>()
    for (const a of actions) {
      const arr = actionsByRule.get(a.rule_id) ?? []
      arr.push(a)
      actionsByRule.set(a.rule_id, arr)
    }

    const rulesByGroup = new Map<number, typeof rules>()
    for (const r of rules) {
      const arr = rulesByGroup.get(r.group_id) ?? []
      arr.push(r)
      rulesByGroup.set(r.group_id, arr)
    }

    return reply.send(
      groups.map((g) => ({
        ...g,
        rules: (rulesByGroup.get(g.id) ?? []).map((r) => ({
          ...r,
          is_enabled: r.is_enabled === 1,
          conditions: condsByRule.get(r.id) ?? [],
          actions: actionsByRule.get(r.id) ?? [],
        })),
      })),
    )
  })

  // POST /api/rules/groups
  app.post('/api/rules/groups', { preHandler: authenticate }, async (request, reply) => {
    const body = z.object({ name: z.string().min(1).max(256) }).safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Invalid input' })

    const db = getDb()
    const maxOrder = db
      .prepare(`SELECT COALESCE(MAX(sort_order), 0) as m FROM rule_groups`)
      .get() as { m: number }
    const result = db
      .prepare(`INSERT INTO rule_groups (name, sort_order, created_at) VALUES (?, ?, ?)`)
      .run(body.data.name, maxOrder.m + 1, new Date().toISOString())

    logAudit({
      userId: request.user!.id,
      username: request.user!.username,
      eventType: 'rule_group.created',
      entityType: 'rule_group',
      entityId: result.lastInsertRowid as number,
      details: { name: body.data.name },
    })
    return reply.code(201).send({ id: result.lastInsertRowid })
  })

  // PUT /api/rules/groups/:id
  app.put('/api/rules/groups/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = z.object({ name: z.string().min(1).max(256) }).safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Invalid input' })

    const db = getDb()
    if (!db.prepare(`SELECT id FROM rule_groups WHERE id = ?`).get(id)) {
      return reply.code(404).send({ error: 'Group not found' })
    }

    db.prepare(`UPDATE rule_groups SET name = ? WHERE id = ?`).run(body.data.name, id)
    logAudit({
      userId: request.user!.id,
      username: request.user!.username,
      eventType: 'rule_group.updated',
      entityType: 'rule_group',
      entityId: parseInt(id, 10),
      details: { name: body.data.name },
    })
    return reply.send({ ok: true })
  })

  // DELETE /api/rules/groups/:id
  app.delete('/api/rules/groups/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const db = getDb()
    if (!db.prepare(`SELECT id FROM rule_groups WHERE id = ?`).get(id)) {
      return reply.code(404).send({ error: 'Group not found' })
    }

    db.prepare(`DELETE FROM rule_groups WHERE id = ?`).run(id)
    logAudit({
      userId: request.user!.id,
      username: request.user!.username,
      eventType: 'rule_group.deleted',
      entityType: 'rule_group',
      entityId: parseInt(id, 10),
      details: {},
    })
    return reply.send({ ok: true })
  })

  // POST /api/rules/run — run all enabled rules against all transactions
  app.post('/api/rules/run', { preHandler: authenticate }, async (request, reply) => {
    const db = getDb()
    const updatedCount = runRulesOnAllTransactions(db)

    logAudit({
      userId: request.user!.id,
      username: request.user!.username,
      eventType: 'rules.run',
      entityType: 'transaction',
      entityId: 0,
      details: { updatedCount },
    })

    return reply.send({ updatedCount })
  })

  // POST /api/rules/:id/run — run a single rule against all transactions
  app.post('/api/rules/:id/run', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const db = getDb()
    const updatedCount = runSingleRule(parseInt(id, 10), db)

    logAudit({
      userId: request.user!.id,
      username: request.user!.username,
      eventType: 'rules.run',
      entityType: 'rule',
      entityId: parseInt(id, 10),
      details: { updatedCount },
    })

    return reply.send({ updatedCount })
  })

  // POST /api/rules
  app.post('/api/rules', { preHandler: authenticate }, async (request, reply) => {
    const body = ruleBodySchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Invalid input', issues: body.error.issues })

    const db = getDb()
    const { name, groupId, conditionLogic, isEnabled, conditions, actions } = body.data

    if (!db.prepare(`SELECT id FROM rule_groups WHERE id = ?`).get(groupId)) {
      return reply.code(400).send({ error: 'Group not found' })
    }

    const conflict = checkConflict(null, conditions, conditionLogic as ConditionLogic, actions.map((a) => a.field), db)
    if (conflict) {
      return reply.code(409).send({ error: `Conflicts with rule "${conflict.name}"`, conflictingRuleId: conflict.id })
    }

    const now = new Date().toISOString()
    const maxOrder = db
      .prepare(`SELECT COALESCE(MAX(sort_order), 0) as m FROM rules WHERE group_id = ?`)
      .get(groupId) as { m: number }

    const ruleResult = db
      .prepare(
        `INSERT INTO rules (group_id, name, condition_logic, is_enabled, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(groupId, name, conditionLogic, isEnabled ? 1 : 0, maxOrder.m + 1, now, now)

    const ruleId = ruleResult.lastInsertRowid as number

    const insertCond = db.prepare(
      `INSERT INTO rule_conditions (rule_id, field, operator, value) VALUES (?, ?, ?, ?)`,
    )
    for (const c of conditions) insertCond.run(ruleId, c.field, c.operator, c.value)

    const insertAction = db.prepare(`INSERT INTO rule_actions (rule_id, field, value) VALUES (?, ?, ?)`)
    for (const a of actions) insertAction.run(ruleId, a.field, a.value)

    logAudit({
      userId: request.user!.id,
      username: request.user!.username,
      eventType: 'rule.created',
      entityType: 'rule',
      entityId: ruleId,
      details: { name },
    })
    return reply.code(201).send({ id: ruleId })
  })

  // PUT /api/rules/:id
  app.put('/api/rules/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = ruleBodySchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Invalid input', issues: body.error.issues })

    const db = getDb()
    if (!db.prepare(`SELECT id FROM rules WHERE id = ?`).get(id)) {
      return reply.code(404).send({ error: 'Rule not found' })
    }

    const { name, groupId, conditionLogic, isEnabled, conditions, actions } = body.data

    const conflict = checkConflict(
      parseInt(id, 10),
      conditions,
      conditionLogic as ConditionLogic,
      actions.map((a) => a.field),
      db,
    )
    if (conflict) {
      return reply.code(409).send({ error: `Conflicts with rule "${conflict.name}"`, conflictingRuleId: conflict.id })
    }

    const now = new Date().toISOString()
    db.prepare(
      `UPDATE rules SET group_id = ?, name = ?, condition_logic = ?, is_enabled = ?, updated_at = ? WHERE id = ?`,
    ).run(groupId, name, conditionLogic, isEnabled ? 1 : 0, now, id)

    db.prepare(`DELETE FROM rule_conditions WHERE rule_id = ?`).run(id)
    const insertCond = db.prepare(
      `INSERT INTO rule_conditions (rule_id, field, operator, value) VALUES (?, ?, ?, ?)`,
    )
    for (const c of conditions) insertCond.run(id, c.field, c.operator, c.value)

    db.prepare(`DELETE FROM rule_actions WHERE rule_id = ?`).run(id)
    const insertAction = db.prepare(`INSERT INTO rule_actions (rule_id, field, value) VALUES (?, ?, ?)`)
    for (const a of actions) insertAction.run(id, a.field, a.value)

    logAudit({
      userId: request.user!.id,
      username: request.user!.username,
      eventType: 'rule.updated',
      entityType: 'rule',
      entityId: parseInt(id, 10),
      details: { name },
    })
    return reply.send({ ok: true })
  })

  // DELETE /api/rules/:id
  app.delete('/api/rules/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const db = getDb()
    if (!db.prepare(`SELECT id FROM rules WHERE id = ?`).get(id)) {
      return reply.code(404).send({ error: 'Rule not found' })
    }

    db.prepare(`DELETE FROM rules WHERE id = ?`).run(id)
    logAudit({
      userId: request.user!.id,
      username: request.user!.username,
      eventType: 'rule.deleted',
      entityType: 'rule',
      entityId: parseInt(id, 10),
      details: {},
    })
    return reply.send({ ok: true })
  })
}
