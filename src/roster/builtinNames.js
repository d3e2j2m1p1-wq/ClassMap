// ═══════════════════════════════════════════════
//  ROSTER PARSING
// ═══════════════════════════════════════════════
// Common names database for group auto-detection
export const GENDER_NAMES = {
  boy: new Set([
    'james','john','robert','michael','william','david','richard','joseph','thomas','charles',
    'christopher','daniel','matthew','anthony','mark','donald','steven','paul','andrew','joshua',
    'kenneth','kevin','brian','george','timothy','ronald','edward','jason','jeffrey','ryan',
    'jacob','gary','nicholas','eric','jonathan','stephen','larry','justin','scott','brandon',
    'benjamin','samuel','raymond','gregory','frank','alexander','patrick','jack','dennis','jerry',
    'tyler','aaron','jose','adam','henry','nathan','zachary','douglas','peter','kyle','noah',
    'ethan','jeremy','christian','walter','keith','austin','roger','terry','sean','gerald',
    'carl','dylan','harold','jordan','jesse','bryan','lawrence','arthur','gabriel','bruce',
    'liam','mason','logan','lucas','aiden','oliver','elijah','owen','caleb','isaiah','leo',
    'landon','lincoln','julian','brayden','colton','tristan','evan','hunter','dominic','xavier',
    'luke','carter','wyatt','silas','miles','nolan','max','eli','ian','axel','joaquin','roman',
    'easton','emmett','camden','rhys','archer','atlas','brooks','chase','cole','cruz','grayson',
    'adrian','drew','sawyer','kai','finn','alex','chris','sam','pat','cameron','riley','morgan',
    'miguel','diego','mateo','santiago','carlos','juan','luis','jorge','angel','ricardo','fernando',
    'javier','manuel','pedro','alejandro','sebastian','andres','oscar','victor','hector','edgar','ivan',
    'ruben','raul','omar','marco','antonio','francisco','eduardo','rafael','emilio','jayden','jaxon',
    'bryce','brandon','cesar','armando','gerardo','salvador','adrian','erik','enrique','alberto',
    'david','daniel','gabriel','isaac','ezra','josiah','levi','micah','nico','nikolai','dmitri','ali',
    'ahmed','mohammed','muhammad','omar','hassan','khalid','wei','jin','hiroshi','kenji','takeshi',
    'minh','anh','hung','duc','jun','hyun','arjun','rohan','vikram','raj','sanjay','amir','ravi'
  ]),
  girl: new Set([
    'mary','patricia','jennifer','linda','barbara','elizabeth','susan','jessica','sarah','karen',
    'lisa','nancy','betty','margaret','sandra','ashley','kimberly','emily','donna','michelle',
    'carol','amanda','melissa','deborah','stephanie','rebecca','sharon','laura','cynthia',
    'kathleen','amy','angela','shirley','anna','brenda','pamela','emma','nicole','helen',
    'samantha','katherine','christine','debra','rachel','carolyn','janet','catherine','maria',
    'heather','diane','julie','joyce','victoria','kelly','christina','joan','evelyn','lauren',
    'judith','olivia','frances','martha','cheryl','megan','andrea','hannah','jacqueline','ann',
    'jean','alice','kathryn','gloria','teresa','doris','sara','janice','julia','marie','madison',
    'grace','judy','theresa','beverly','denise','marilyn','amber','danielle','brittany','diana',
    'abigail','virginia','alyssa','kayla','alexis','tiffany','crystal','brianna','natalie',
    'sophia','isabella','charlotte','mia','ava','luna','scarlett','eleanor','nora','hazel',
    'aurora','savannah','brooklyn','bella','claire','skylar','lucy','paisley','everly','caroline',
    'genesis','kennedy','ruby','aaliyah','kinsley','maya','harper','violet','zoe','penelope',
    'riley','layla','lillian','elena','leah','stella','willow','ellie','naomi','chloe','ariana',
    'eden','gabriella','camila','lily','aria','taylor','aubrey','audrey','kaylee','alexa',
    'nevaeh','eva','lydia','autumn','vivian','adalyn','faith','jade','serenity','amelia',
    'avery','peyton','quinn','sienna','sofia','elena','natalia','valentina','isabella','alex',
    'cameron','riley','morgan','jamie','taylor','jordan','casey','alexis','avery','kendall',
    'ximena','lucia','daniela','mariana','gabriela','fernanda','paola','carmen','rosa','ana','juana',
    'yesenia','esmeralda','jazmin','itzel','abril','valeria','isabel','marisol','guadalupe','alejandra',
    'adriana','angelica','araceli','beatriz','blanca','claudia','cristina','dulce','elisa','estrella',
    'evelyn','fatima','flor','jasmine','karina','liliana','lorena','lupita','monica','nayeli','paloma',
    'patricia','paulina','rocio','sandra','selena','silvia','susana','vanessa','veronica','yolanda',
    'zoey','aisha','amira','layla','leila','noor','mei','yuki','sakura','hana','linh','mai','lan',
    'thu','ji','mina','priya','anjali','neha','pooja','aaliyah','imani','nia','zara','kaitlyn','kylie'
  ])
};

// First name from "First Last" or "Last, First"
export function firstNameOf(name) {
  name = String(name || '').trim();
  if (name.includes(',')) name = name.split(',')[1] || name;
  return (name.trim().split(/\s+/)[0] || '');
}
