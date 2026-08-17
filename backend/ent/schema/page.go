// Package schema 定义附属内容系统的 Ent schema。
//
// 动态页面管理: Page —— 管理员创建的动态页面记录。可 CRUD(非只追加)。
//
// 与 PageView/FeatureClick(只追加埋点)不同, Page 是可变实体:
// 管理员可创建/编辑/删除/启停。page_id 在埋点表里为 "page:<slug>"(命名空间隔离),
// 避免与静态核心页 id(home/dashboard/homepage-config)冲突。
package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// Page 是管理员创建的动态页面。可 CRUD, 区别于只追加的埋点表。
type Page struct {
	ent.Schema
}

// Annotations 返回 schema 的注解配置。
func (Page) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{Table: "pages"},
	}
}

// Fields 定义动态页面字段。
func (Page) Fields() []ent.Field {
	return []ent.Field{
		// slug: 页面路由标识, 唯一。路由为 /p/<slug> 或 /admin/p/<slug>。
		field.String("slug").
			MaxLen(128).
			NotEmpty().
			Comment("页面 slug, 路由 /p/<slug> 或 /admin/p/<slug>"),
		// title: 页面标题(展示用)。
		field.String("title").
			MaxLen(256).
			NotEmpty().
			Comment("页面标题(展示用)"),
		// visibility: 可见性, public 无需认证; admin 需管理员会话。
		field.String("visibility").
			MaxLen(16).
			Default("public").
			Comment("可见性: public 或 admin"),
		// content_type: 内容类型, html(v1 iframe 沙箱) 或 react(v2 动态编译)。
		field.String("content_type").
			MaxLen(16).
			Default("html").
			Comment("内容类型: html 或 react(v2)"),
		// content_html: HTML 内容, 经 iframe 沙箱渲染。
		field.String("content_html").
			Optional().
			SchemaType(map[string]string{
				dialect.Postgres: "text",
			}).
			Comment("HTML 内容(iframe 沙箱渲染)"),
		// content_react: React/TSX 源码, v2 动态编译渲染。
		field.String("content_react").
			Optional().
			SchemaType(map[string]string{
				dialect.Postgres: "text",
			}).
			Comment("React/TSX 源码(v2 动态编译渲染)"),
		// enabled: 是否启用。停用页 404, 但行与埋点历史保留。
		field.Bool("enabled").
			Default(true).
			Comment("是否启用(停用页 404, 行与埋点保留)"),
		// created_at: 创建时间, 不可变。
		field.Time("created_at").
			Default(time.Now).
			Immutable().
			SchemaType(map[string]string{
				dialect.Postgres: "timestamptz",
			}).
			Comment("创建时间"),
		// updated_at: 更新时间, 可变(与只追加表的 created_at 不同)。
		field.Time("updated_at").
			Default(time.Now).
			UpdateDefault(time.Now).
			SchemaType(map[string]string{
				dialect.Postgres: "timestamptz",
			}).
			Comment("更新时间"),
	}
}

// Edges 定义关联关系(无)。
func (Page) Edges() []ent.Edge {
	return nil
}

// Indexes 定义索引, 优化查询。
func (Page) Indexes() []ent.Index {
	return []ent.Index{
		// slug 唯一索引: 路由查找 + 防止重复创建。
		index.Fields("slug").Unique(),
		// visibility 索引: 按可见性过滤(public/admin)。
		index.Fields("visibility"),
		// enabled 索引: 过滤启停状态。
		index.Fields("enabled"),
	}
}
