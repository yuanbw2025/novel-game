// 故事游戏核心类型与 AI 生成

import { chat, type AIClientConfig, type ChatMessage } from './client'

// ═══════════════════════════════════════
//  数据结构
// ═══════════════════════════════════════

export interface Character {
  id: string
  name: string
  color: string        // hex
}

export interface GameVariable {
  name: string         // JS 标识符，如 "courage"
  label: string        // 显示名，如 "勇气值"
  type: 'number' | 'boolean'
  defaultValue: number | boolean
}

export interface Achievement {
  id: string
  title: string
  description: string
  icon: string
}

export type VarOp = 'set' | 'add' | 'toggle'

export interface VariableEffect {
  variable: string
  op: VarOp
  value: number | boolean
}

export interface StoryChoice {
  id: string
  text: string
  nextNodeId: string
  condition?: string         // 如 "courage >= 3"
  effects?: VariableEffect[]
}

export type NodeType = 'start' | 'scene' | 'ending'

export interface StoryNode {
  id: string
  type: NodeType
  title: string
  content: string
  speakerId?: string
  x: number
  y: number
  choices: StoryChoice[]
  effects?: VariableEffect[]
  achievementId?: string
}

export interface StoryGame {
  id: string
  title: string
  description: string
  author: string
  startNodeId: string
  nodes: StoryNode[]
  characters: Character[]
  variables: GameVariable[]
  achievements: Achievement[]
}

// ═══════════════════════════════════════
//  AI 生成
// ═══════════════════════════════════════

const SYSTEM_PROMPT = `你是一位互动小说设计师，专门将故事/剧本转化为分支叙事文本游戏。

将用户提供的故事转换为JSON格式游戏数据，要求：

节点设计：
- 至少12个节点；start类型只有1个（开始），scene为普通场景，ending为结局
- 至少3个不同结局（好结局/坏结局/隐藏结局各一），结局节点choices为空数组
- 每个scene节点有2-3个选项，形成真正的分支叙事
- 内容生动有代入感，保留原文风格，每段100-200字

角色系统：提取主要角色，分配鲜明颜色（如 #4F46E5 #DC2626 #059669 #D97706）

变量系统：根据故事设计1-3个有意义的数值变量（如勇气值、好感度、声望），在选项效果中使用

成就系统：3-5个成就，绑定到特定结局节点的achievementId字段

输出严格JSON（不含任何其他文字）：
{
  "title": "游戏标题",
  "description": "一句话简介",
  "author": "",
  "characters": [
    { "id": "char_1", "name": "角色名", "color": "#4F46E5" }
  ],
  "variables": [
    { "name": "courage", "label": "勇气值", "type": "number", "defaultValue": 0 }
  ],
  "achievements": [
    { "id": "ach_1", "title": "成就名", "description": "解锁描述", "icon": "🏆" }
  ],
  "startNodeId": "node_1",
  "nodes": [
    {
      "id": "node_1",
      "type": "start",
      "title": "场景名称",
      "content": "呈现给玩家的叙事文字",
      "speakerId": "char_1",
      "x": 0, "y": 0,
      "effects": [],
      "achievementId": null,
      "choices": [
        {
          "id": "c1_1",
          "text": "选项文字（15字以内）",
          "nextNodeId": "node_2",
          "condition": "",
          "effects": [{"variable": "courage", "op": "add", "value": 1}]
        }
      ]
    }
  ]
}`

export async function generateStoryGame(
  storyText: string,
  config: AIClientConfig
): Promise<StoryGame> {
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `将以下故事转换为互动游戏：\n\n${storyText}` },
  ]

  const result = await chat(config, messages)
  if (!result.success || !result.content) {
    throw new Error(result.error || 'AI 未返回内容')
  }

  const match = result.content.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('AI 未返回有效 JSON，请重试')

  let data: any
  try { data = JSON.parse(match[0]) }
  catch { throw new Error('JSON 解析失败，请重试') }

  const game: StoryGame = {
    id: `game_${Date.now()}`,
    title: data.title || '未命名故事',
    description: data.description || '',
    author: data.author || '',
    startNodeId: data.startNodeId || data.nodes?.[0]?.id || 'node_1',
    nodes: (data.nodes || []).map((n: any) => ({
      ...n, x: 0, y: 0,
      choices: n.choices || [],
      effects: n.effects || [],
    })),
    characters: data.characters || [],
    variables: data.variables || [],
    achievements: data.achievements || [],
  }

  assignTreeLayout(game)
  return game
}

// ═══════════════════════════════════════
//  BFS 树布局
// ═══════════════════════════════════════

export const TREE_XSTEP = 240
export const TREE_YSTEP = 180

export function assignTreeLayout(game: StoryGame) {
  const nodeMap = new Map(game.nodes.map(n => [n.id, n]))
  const depthOf = new Map<string, number>()
  const depthBuckets = new Map<number, string[]>()
  const visited = new Set<string>()
  const queue: { id: string; depth: number }[] = [{ id: game.startNodeId, depth: 0 }]

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!
    if (visited.has(id) || !nodeMap.has(id)) continue
    visited.add(id)
    depthOf.set(id, depth)
    if (!depthBuckets.has(depth)) depthBuckets.set(depth, [])
    depthBuckets.get(depth)!.push(id)
    for (const c of nodeMap.get(id)!.choices) {
      if (!visited.has(c.nextNodeId)) queue.push({ id: c.nextNodeId, depth: depth + 1 })
    }
  }

  // 孤立节点追加到末尾
  for (const node of game.nodes) {
    if (!visited.has(node.id)) {
      const maxD = depthBuckets.size > 0 ? Math.max(...depthBuckets.keys()) + 1 : 0
      depthOf.set(node.id, maxD)
      if (!depthBuckets.has(maxD)) depthBuckets.set(maxD, [])
      depthBuckets.get(maxD)!.push(node.id)
    }
  }

  for (const [depth, ids] of depthBuckets.entries()) {
    ids.forEach((id, idx) => {
      const node = nodeMap.get(id)
      if (node) {
        node.x = (idx - (ids.length - 1) / 2) * TREE_XSTEP
        node.y = depth * TREE_YSTEP
      }
    })
  }
}

export function emptyGame(): StoryGame {
  return {
    id: `game_${Date.now()}`,
    title: '新故事',
    description: '',
    author: '',
    startNodeId: 'node_1',
    nodes: [
      { id: 'node_1', type: 'start', title: '序章', content: '故事从这里开始...', x: 0, y: 0, choices: [{ id: 'c1', text: '继续', nextNodeId: 'node_2' }] },
      { id: 'node_2', type: 'ending', title: '结局', content: '你的故事落下帷幕。', x: 0, y: 180, choices: [] },
    ],
    characters: [],
    variables: [],
    achievements: [],
  }
}
