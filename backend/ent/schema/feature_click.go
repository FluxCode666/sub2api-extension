// Package schema 定义附属内容系统的 Ent schema。
//
// U5: FeatureClick —— 功能使用埋点记录。只追加表(不更新不删除)。
//
// 风格镜像 sub2api usage_log.go 的只追加 + created_at + 索引风格。
// 记录用户在页面内对某个功能(如按钮)的点击,用于功能使用分析。
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

// FeatureClick 记录一次功能点击。只追加,不更新不删除。
type FeatureClick struct {
	ent.Schema
}

// Annotations 返回 schema 的注解配置。
func (FeatureClick) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{Table: "feature_clicks"},
	}
}

// Fields 定义功能点击埋点字段。
func (FeatureClick) Fields() []ent.Field {
	return []ent.Field{
		// page_id: 点击发生在哪个页面(来自 page-registry)。
		field.String("page_id").
			MaxLen(128).
			NotEmpty().
			Comment("页面 id, 来自 page-registry"),
		// feature_id: 被点击的功能标识(前端约定, 如 "refresh-btn")。
		field.String("feature_id").
			MaxLen(128).
			NotEmpty().
			Comment("功能标识, 前端约定"),
		// visitor_id: 匿名访客标识。
		field.String("visitor_id").
			MaxLen(128).
			NotEmpty().
			Comment("匿名访客 id"),
		// is_admin: 区分管理员与匿名访问。
		field.Bool("is_admin").
			Default(false).
			Comment("是否管理员访问"),
		// created_at: 只追加, 不可修改。
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
func (FeatureClick) Edges() []ent.Edge {
	return nil
}

// Indexes 定义索引, 优化 U6 聚合查询。
func (FeatureClick) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("page_id"),
		index.Fields("feature_id"),
		index.Fields("visitor_id"),
		index.Fields("created_at"),
		// 复合索引用于按页面 + 功能聚合
		index.Fields("page_id", "feature_id"),
		// 复合索引用于按页面 + 时间范围聚合
		index.Fields("page_id", "created_at"),
	}
}
