// Package schema 定义附属内容系统的 Ent schema。
//
// U5: PageView —— 页面访问埋点记录。只追加表(不更新不删除)。
//
// 风格镜像 sub2api backend/ent/schema/usage_log.go 的只追加 + created_at + 索引风格,
// 但附属系统是独立 module,不导入 sub2api 包。
//
// 访问量按访问计: 同一访客重复访问 → 多条记录(非去重为 1)。
// page_id 来自前端 page-registry 的 id(KTD7),由前端解析路由后上报。
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

// PageView 记录一次页面访问。只追加,不更新不删除。
type PageView struct {
	ent.Schema
}

// Annotations 返回 schema 的注解配置。
func (PageView) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{Table: "page_views"},
	}
}

// Fields 定义页面访问埋点字段。
func (PageView) Fields() []ent.Field {
	return []ent.Field{
		// page_id 来自合并页面注册表的 id(静态核心页或 "page:<slug>")。
		field.String("page_id").
			MaxLen(128).
			NotEmpty().
			Comment("页面 id, 来自 page-registry"),
		// visitor_id 是匿名访客的持久标识(localStorage 生成)。
		field.String("visitor_id").
			MaxLen(128).
			NotEmpty().
			Comment("匿名访客 id"),
		// is_admin 区分管理员访问与匿名访问(U6 归因用)。
		field.Bool("is_admin").
			Default(false).
			Comment("是否管理员访问"),
		// created_at: 只追加表, 不可修改。
		field.Time("created_at").
			Default(time.Now).
			Immutable().
			SchemaType(map[string]string{
				dialect.Postgres: "timestamptz",
			}).
			Comment("记录创建时间"),
	}
}

// Edges 定义关联关系(无)。
func (PageView) Edges() []ent.Edge {
	return nil
}

// Indexes 定义索引, 优化 U6 聚合查询。
func (PageView) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("page_id"),
		index.Fields("visitor_id"),
		index.Fields("created_at"),
		// 复合索引用于按页面 + 时间范围聚合
		index.Fields("page_id", "created_at"),
	}
}
