/**
 * Mock 商品数据 - 淘宝风格
 */
export interface Product {
  id: string;
  title: string;
  price: number; // 元
  originalPrice?: number;
  image: string;
  shopName: string;
  category?: string; // 数码、家居、女装、美妆、母婴、运动等
  sales?: number;
  rating?: number;
  tags?: string[];
  label?: string;
}

// 使用 picsum.photos 占位图，实际可替换为 CDN
const PLACEHOLDER = "https://picsum.photos/400/600";

export const MOCK_PRODUCTS: Product[] = [
  {
    id: "1",
    title: "故宫淘宝|宫猫将军摆件 汽车车内饰品办公室文创礼物",
    category: "文创",
    price: 35,
    originalPrice: 58,
    image: `${PLACEHOLDER}?random=1`,
    shopName: "故宫淘宝旗舰店",
    sales: 2.3e4,
    rating: 4.9,
    tags: ["官方立减10%"],
    label: "来自故宫的礼物",
  },
  {
    id: "2",
    title: "【淘宝闪购】vivo Y50 5G官方正品五年寿命大电池",
    category: "数码",
    price: 1299,
    originalPrice: 1799,
    image: `${PLACEHOLDER}?random=2`,
    shopName: "vivo官方旗舰店",
    sales: 5.1e4,
    rating: 4.8,
    tags: ["会员领券满300-10"],
  },
  {
    id: "3",
    title: "故宫淘宝|朕的印章御批 文字木质手帐套装生日礼物",
    category: "文创",
    price: 68,
    originalPrice: 98,
    image: `${PLACEHOLDER}?random=3`,
    shopName: "故宫淘宝旗舰店",
    sales: 8.8e4,
    rating: 4.9,
    tags: ["限时特惠"],
    label: "来自故宫的礼物",
  },
  {
    id: "4",
    title: "蜡笔小新联名款 铅笔盒 学生文具大容量",
    category: "文具",
    price: 39.9,
    originalPrice: 59,
    image: `${PLACEHOLDER}?random=4`,
    shopName: "文具生活馆",
    sales: 12e4,
    rating: 4.7,
    tags: ["今日必抢"],
  },
  {
    id: "5",
    title: "AirPods保护套 硅胶防摔 多色可选",
    category: "数码",
    price: 29,
    originalPrice: 49,
    image: `${PLACEHOLDER}?random=5`,
    shopName: "数码配件专营",
    sales: 3.2e4,
    rating: 4.8,
    tags: ["7天无理由"],
  },
  {
    id: "6",
    title: "简约现代餐桌 实木 小户型家用",
    category: "家居",
    price: 599,
    originalPrice: 899,
    image: `${PLACEHOLDER}?random=6`,
    shopName: "家居旗舰店",
    sales: 1.5e4,
    rating: 4.6,
  },
  {
    id: "7",
    title: "大码女装 显瘦连衣裙 夏季新款",
    category: "女装",
    price: 129,
    originalPrice: 259,
    image: `${PLACEHOLDER}?random=7`,
    shopName: "女装专营店",
    sales: 6800,
    rating: 4.7,
    tags: ["新品"],
  },
  {
    id: "8",
    title: "拖鞋女 居家防滑 夏季凉拖",
    category: "鞋靴",
    price: 19.9,
    originalPrice: 39,
    image: `${PLACEHOLDER}?random=8`,
    shopName: "鞋靴专营",
    sales: 4.2e4,
    rating: 4.5,
  },
  { id: "9", title: "护照保护套 真皮 多国旅行", price: 45, image: `${PLACEHOLDER}?random=9`, shopName: "旅行用品", sales: 8900, rating: 4.8 },
  { id: "10", title: "生日布置 气球派对 场景装饰", price: 58, originalPrice: 88, image: `${PLACEHOLDER}?random=10`, shopName: "派对用品", sales: 2.1e4, rating: 4.9 },
  { id: "11", title: "布艺沙发 北欧简约 小户型三人位", price: 1280, originalPrice: 1999, image: `${PLACEHOLDER}?random=11`, shopName: "家居旗舰店", sales: 3200, rating: 4.7, tags: ["包邮"] },
  { id: "12", title: "蜡笔小新手办 动漫周边 正版授权", price: 89, originalPrice: 139, image: `${PLACEHOLDER}?random=12`, shopName: "动漫周边", sales: 1.8e4, rating: 4.9, tags: ["正版"] },
  { id: "13", title: "故宫淘宝 千里江山图 书签 文艺", price: 28, image: `${PLACEHOLDER}?random=13`, shopName: "故宫淘宝旗舰店", sales: 3.5e4, rating: 4.9, label: "来自故宫的礼物" },
  { id: "14", title: "vivo 充电器 快充 原装", price: 49, originalPrice: 79, image: `${PLACEHOLDER}?random=14`, shopName: "vivo官方旗舰店", sales: 2.2e4, rating: 4.8 },
  { id: "15", title: "玩具遥控汽车 儿童 充电", price: 158, originalPrice: 258, image: `${PLACEHOLDER}?random=15`, shopName: "玩具总动员", sales: 5.2e4, rating: 4.6, tags: ["热销"] },
  { id: "16", title: "大码女装 阔腿裤 高腰显瘦", price: 79, originalPrice: 159, image: `${PLACEHOLDER}?random=16`, shopName: "女装专营店", sales: 1.2e4, rating: 4.7 },
  { id: "17", title: "北欧风茶几  ins 简约", price: 299, originalPrice: 499, image: `${PLACEHOLDER}?random=17`, shopName: "家居旗舰店", sales: 6800, rating: 4.5 },
  { id: "18", title: "蓝牙音箱 便携 户外", price: 99, originalPrice: 169, image: `${PLACEHOLDER}?random=18`, shopName: "数码好物", sales: 4.1e4, rating: 4.8, tags: ["爆款"] },
  { id: "19", title: "女式凉鞋 粗跟 夏季新款", price: 69, originalPrice: 129, image: `${PLACEHOLDER}?random=19`, shopName: "鞋靴专营", sales: 2.8e4, rating: 4.6 },
  { id: "20", title: "故宫淘宝 冰箱贴 文创礼品", price: 18, image: `${PLACEHOLDER}?random=20`, shopName: "故宫淘宝旗舰店", sales: 6.2e4, rating: 4.9, label: "来自故宫的礼物" },
  { id: "21", title: "机械键盘 青轴 游戏电竞", price: 299, originalPrice: 499, image: `${PLACEHOLDER}?random=21`, shopName: "数码配件专营", sales: 1.5e4, rating: 4.8, tags: ["RGB"] },
  { id: "22", title: "婴儿奶瓶 防胀气 宽口径", price: 68, originalPrice: 98, image: `${PLACEHOLDER}?random=22`, shopName: "母婴专营", sales: 3.2e4, rating: 4.9 },
  { id: "23", title: "面膜 补水面膜 10片装", price: 39, originalPrice: 89, image: `${PLACEHOLDER}?random=23`, shopName: "美妆优选", sales: 8.1e4, rating: 4.7, tags: ["限时"] },
  { id: "24", title: "蜡笔小新 抱枕 午睡枕", price: 45, originalPrice: 78, image: `${PLACEHOLDER}?random=24`, shopName: "动漫周边", sales: 2.4e4, rating: 4.8 },
  { id: "25", title: "瑜伽垫 加厚 防滑", price: 59, originalPrice: 99, image: `${PLACEHOLDER}?random=25`, shopName: "运动户外旗舰", sales: 5.8e4, rating: 4.7 },
  { id: "26", title: "挂烫机 手持 家用", price: 129, originalPrice: 199, image: `${PLACEHOLDER}?random=26`, shopName: "生活好物", sales: 2.1e4, rating: 4.6 },
  { id: "27", title: "故宫淘宝 胶带 和纸 手帐", price: 12, image: `${PLACEHOLDER}?random=27`, shopName: "故宫淘宝旗舰店", sales: 9.5e4, rating: 4.9, label: "来自故宫的礼物" },
  { id: "28", title: "床上四件套 纯棉 1.8m", price: 168, originalPrice: 298, image: `${PLACEHOLDER}?random=28`, shopName: "家居旗舰店", sales: 4.2e4, rating: 4.8 },
  { id: "29", title: "电动牙刷 声波 情侣款", price: 199, originalPrice: 399, image: `${PLACEHOLDER}?random=29`, shopName: "数码好物", sales: 3.5e4, rating: 4.8, tags: ["爆款"] },
  { id: "30", title: "零食大礼包 坚果 混合", price: 68, originalPrice: 98, image: `${PLACEHOLDER}?random=30`, shopName: "吃货研究所", sales: 6.8e4, rating: 4.7 },
  { id: "31", title: "台灯 护眼 学习  led", price: 89, originalPrice: 159, image: `${PLACEHOLDER}?random=31`, shopName: "生活好物", sales: 2.9e4, rating: 4.6 },
  { id: "32", title: "vivo 手机壳 透明 保护套", price: 29, originalPrice: 49, image: `${PLACEHOLDER}?random=32`, shopName: "vivo官方旗舰店", sales: 4.5e4, rating: 4.7 },
  { id: "33", title: "儿童绘本 启蒙 3-6岁", price: 35, originalPrice: 58, image: `${PLACEHOLDER}?random=33`, shopName: "亲子乐园", sales: 1.8e4, rating: 4.9 },
  { id: "34", title: "香薰机 超声波 加湿", price: 78, originalPrice: 128, image: `${PLACEHOLDER}?random=34`, shopName: "生活好物", sales: 3.2e4, rating: 4.7 },
  { id: "35", title: "遮阳伞 晴雨两用 迷你", price: 45, originalPrice: 79, image: `${PLACEHOLDER}?random=35`, shopName: "日用百货", sales: 5.1e4, rating: 4.6 },
  { id: "36", title: "故宫淘宝 香囊 古风 端午", price: 38, image: `${PLACEHOLDER}?random=36`, shopName: "故宫淘宝旗舰店", sales: 2.6e4, rating: 4.9, label: "来自故宫的礼物" },
  { id: "37", title: "笔记本 游戏本 15.6英寸", price: 4999, originalPrice: 5999, image: `${PLACEHOLDER}?random=37`, shopName: "数码好物", sales: 3200, rating: 4.8, tags: ["满减"] },
  { id: "38", title: "儿童书包 护脊 减负", price: 128, originalPrice: 198, image: `${PLACEHOLDER}?random=38`, shopName: "文具生活馆", sales: 2.2e4, rating: 4.8 },
  { id: "39", title: "茶具 陶瓷 功夫茶", price: 158, originalPrice: 258, image: `${PLACEHOLDER}?random=39`, shopName: "茶艺轩", sales: 8900, rating: 4.7 },
  { id: "40", title: "洗面奶 氨基酸 温和", price: 49, originalPrice: 99, image: `${PLACEHOLDER}?random=40`, shopName: "美妆优选", sales: 7.2e4, rating: 4.8 },
  { id: "41", title: "收纳盒 透明 整理", price: 29, originalPrice: 49, image: `${PLACEHOLDER}?random=41`, shopName: "生活好物", sales: 4.8e4, rating: 4.6 },
  { id: "42", title: "蜡笔小新 T恤 情侣 动漫", price: 68, originalPrice: 118, image: `${PLACEHOLDER}?random=42`, shopName: "动漫周边", sales: 1.5e4, rating: 4.8 },
  { id: "43", title: "扫地机器人 智能 扫拖一体", price: 1299, originalPrice: 1999, image: `${PLACEHOLDER}?random=43`, shopName: "数码好物", sales: 5200, rating: 4.7, tags: ["新品"] },
  { id: "44", title: "抱枕 卡通 办公室 腰靠", price: 35, originalPrice: 59, image: `${PLACEHOLDER}?random=44`, shopName: "家居旗舰店", sales: 3.8e4, rating: 4.6 },
  { id: "45", title: "速干毛巾 运动 吸水", price: 19, originalPrice: 39, image: `${PLACEHOLDER}?random=45`, shopName: "运动户外旗舰", sales: 6.2e4, rating: 4.7 },
  { id: "46", title: "数据线 快充 多合一", price: 25, originalPrice: 45, image: `${PLACEHOLDER}?random=46`, shopName: "数码配件专营", sales: 9.1e4, rating: 4.6 },
  { id: "47", title: "故宫淘宝 折扇 古典", price: 58, originalPrice: 88, image: `${PLACEHOLDER}?random=47`, shopName: "故宫淘宝旗舰店", sales: 1.2e4, rating: 4.9, label: "来自故宫的礼物" },
  { id: "48", title: "瑜伽服 女 运动 套装", price: 89, originalPrice: 169, image: `${PLACEHOLDER}?random=48`, shopName: "运动户外旗舰", sales: 2.5e4, rating: 4.7 },
  { id: "49", title: "蒸汽眼罩 缓解疲劳 12片", price: 39, originalPrice: 68, image: `${PLACEHOLDER}?random=49`, shopName: "生活好物", sales: 4.6e4, rating: 4.8 },
  { id: "50", title: "乐高 积木 儿童 创意", price: 198, originalPrice: 298, image: `${PLACEHOLDER}?random=50`, shopName: "玩具总动员", sales: 1.8e4, rating: 4.9, tags: ["益智"] },
];

export const SEARCH_SUGGESTIONS = ["蜡笔小新", "玩具", "铅笔盒", "airpods保护套", "餐桌", "大码女装", "沙发", "拖鞋女", "护照保护套", "生日布置"];
