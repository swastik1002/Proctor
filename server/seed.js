'use strict';
const bcrypt = require('bcryptjs');
const db = require('./db');
const { S, J, audit, mulberry32 } = require('./lib');
const core = require('./core');

const MIN = 60000, HOUR = 3600000, DAY = 86400000;

const Q = { // subject -> questions
  Physics: [
    ['mcq', 'Kinematics', 'easy', 'What is the SI unit of acceleration?', ['m/s²', 'm/s', 'N', 'kg·m/s'], 0, 1, 'Acceleration is change in velocity per unit time, so its unit is (m/s)/s = m/s².'],
    ['mcq', 'Kinematics', 'medium', 'A car starts from rest and accelerates uniformly at 2 m/s². How far does it travel in 5 s?', ['10 m', '25 m', '50 m', '5 m'], 1, 2, 's = ½at² = ½ × 2 × 25 = 25 m.'],
    ['multi', 'Forces', 'medium', 'Which of the following are vector quantities?', ['Velocity', 'Speed', 'Force', 'Displacement', 'Mass'], [0, 2, 3], 3, 'Vectors have both magnitude and direction. Speed and mass are scalars.'],
    ['tf', 'Circular motion', 'easy', 'An object moving in a circle at constant speed has constant velocity.', null, 'false', 1, 'The direction keeps changing, so the velocity changes even though the speed is constant.'],
    ['mcq', "Newton's laws", 'medium', "According to Newton's second law, the net force on a body equals:", ['mass × acceleration', 'mass × velocity', 'mass ÷ acceleration', 'acceleration ÷ mass'], 0, 2, 'F = ma.'],
    ['short', 'Forces', 'easy', 'State the SI unit of force.', ['newton', 'N', 'Newton'], null, 2, 'The newton (N) equals 1 kg·m/s².'],
    ['long', "Newton's laws", 'hard', "Explain Newton's third law of motion and give two everyday examples.", null, null, 5, 'Look for: equal and opposite reaction on a different body; examples such as a rocket, walking or a swimmer pushing water.'],
    ['mcq', 'Momentum', 'hard', 'A 2 kg ball moving at 3 m/s collides and sticks to a 1 kg ball at rest. What is their common velocity?', ['1 m/s', '2 m/s', '3 m/s', '1.5 m/s'], 1, 3, 'Momentum is conserved: 2×3 = 3×v, so v = 2 m/s.'],
    ['mcq', 'Gravitation', 'easy', 'The acceleration due to gravity near the Earth\'s surface is approximately:', ['9.8 m/s²', '98 m/s²', '0.98 m/s²', '1.6 m/s²'], 0, 1, 'g ≈ 9.8 m/s².'],
    ['mcq', 'Work & energy', 'medium', 'How much work is done when a 10 N force moves an object 3 m in the direction of the force?', ['3 J', '13 J', '30 J', '0 J'], 2, 2, 'W = F × d = 10 × 3 = 30 J.'],
    ['tf', 'Work & energy', 'medium', 'If the velocity of an object doubles, its kinetic energy also doubles.', null, 'false', 1, 'KE ∝ v², so doubling the velocity quadruples the kinetic energy.'],
    ['mcq', 'Kinematics', 'medium', 'The slope of a velocity–time graph gives:', ['Acceleration', 'Displacement', 'Speed', 'Distance'], 0, 2, 'Slope = Δv/Δt = acceleration.'],
    ['short', 'Momentum', 'easy', 'Write the formula for linear momentum.', ['p = mv', 'mv', 'p=mv', 'p = m × v'], null, 2, 'Momentum = mass × velocity.'],
    ['mcq', 'Kinematics', 'hard', 'A stone is thrown vertically upward at 20 m/s (take g = 10 m/s²). What maximum height does it reach?', ['10 m', '20 m', '40 m', '5 m'], 1, 3, 'h = v²/2g = 400/20 = 20 m.'],
  ],
  Mathematics: [
    ['mcq', 'Linear equations', 'easy', 'Solve for x: 2x + 6 = 14', ['x = 3', 'x = 4', 'x = 5', 'x = 10'], 1, 1, '2x = 8, so x = 4.'],
    ['mcq', 'Quadratics', 'medium', 'What are the roots of x² − 5x + 6 = 0?', ['1 and 6', '2 and 3', '−2 and −3', '5 and 1'], 1, 2, 'Factorise: (x − 2)(x − 3) = 0.'],
    ['mcq', 'Quadratics', 'medium', 'What is the discriminant of x² + 4x + 4?', ['0', '8', '16', '−16'], 0, 2, 'b² − 4ac = 16 − 16 = 0.'],
    ['tf', 'Identities', 'easy', '(a + b)² = a² + b²', null, 'false', 1, '(a + b)² = a² + 2ab + b².'],
    ['multi', 'Number sense', 'medium', 'Which of these are perfect squares?', ['16', '20', '49', '50', '81'], [0, 2, 4], 3, '16 = 4², 49 = 7², 81 = 9².'],
    ['short', 'Number sense', 'easy', 'What is the value of 3² × 2?', ['18'], null, 2, '9 × 2 = 18.'],
    ['long', 'Quadratics', 'hard', 'Derive the quadratic formula by completing the square.', null, null, 5, 'Expect the full derivation from ax² + bx + c = 0 to x = (−b ± √(b² − 4ac)) / 2a.'],
    ['mcq', 'Factorisation', 'medium', 'Factorise x² − 9.', ['(x − 3)(x − 3)', '(x − 3)(x + 3)', '(x + 9)(x − 1)', 'x(x − 9)'], 1, 2, 'Difference of squares: a² − b² = (a − b)(a + b).'],
    ['mcq', 'Quadratics', 'hard', 'If α and β are the roots of x² − 7x + 10 = 0, what is α² + β²?', ['29', '49', '39', '19'], 0, 3, '(α + β)² − 2αβ = 49 − 20 = 29.'],
    ['mcq', 'Coordinate geometry', 'easy', 'What is the slope of the line y = 3x + 2?', ['2', '3', '5', '1/3'], 1, 1, 'In y = mx + c, m is the slope.'],
    ['tf', 'Quadratics', 'medium', 'A quadratic equation can have at most two real roots.', null, 'true', 1, 'A degree-2 polynomial has at most 2 roots.'],
    ['short', 'Quadratics', 'medium', 'Find the sum of the roots of 2x² − 8x + 3 = 0.', ['4'], null, 2, 'Sum of roots = −b/a = 8/2 = 4.'],
  ],
  'Computer Science': [
    ['mcq', 'Stacks & queues', 'easy', 'Which data structure follows the LIFO principle?', ['Queue', 'Stack', 'Array', 'Graph'], 1, 1, 'Last in, first out describes a stack.'],
    ['mcq', 'Searching', 'easy', 'What is the time complexity of binary search?', ['O(n)', 'O(log n)', 'O(n log n)', 'O(1)'], 1, 1, 'Each step halves the search space.'],
    ['multi', 'Data structures', 'medium', 'Which of these are linear data structures?', ['Array', 'Stack', 'Tree', 'Queue', 'Graph'], [0, 1, 3], 3, 'Trees and graphs are non-linear.'],
    ['tf', 'Stacks & queues', 'easy', 'A queue follows the FIFO principle.', null, 'true', 1, 'First in, first out.'],
    ['short', 'Databases', 'medium', 'What does SQL stand for?', ['Structured Query Language'], null, 2, 'SQL = Structured Query Language.'],
    ['long', 'Data structures', 'hard', 'Compare arrays and linked lists in terms of memory usage and access time.', null, null, 5, 'Arrays: contiguous, O(1) index access, costly insert. Linked lists: dynamic, O(n) access, cheap insert/delete.'],
    ['mcq', 'Sorting', 'medium', 'What is the worst-case time complexity of bubble sort?', ['O(n)', 'O(n log n)', 'O(n²)', 'O(log n)'], 2, 2, 'Nested passes over the list give O(n²).'],
    ['mcq', 'Trees', 'medium', 'Which traversal of a binary search tree visits nodes in sorted order?', ['Preorder', 'Inorder', 'Postorder', 'Level order'], 1, 2, 'Inorder visits left, root, right.'],
    ['mcq', 'Trees', 'hard', 'How many edges does a tree with n nodes have?', ['n', 'n + 1', 'n − 1', '2n'], 2, 3, 'A tree is connected and acyclic: n − 1 edges.'],
    ['tf', 'Recursion', 'medium', 'Recursion always uses less memory than iteration.', null, 'false', 1, 'Each recursive call adds a stack frame.'],
    ['mcq', 'Number systems', 'easy', 'What is the binary representation of decimal 10?', ['1001', '1010', '1100', '1110'], 1, 1, '8 + 2 = 10, so 1010.'],
    ['short', 'Python', 'easy', 'Which keyword is used to define a function in Python?', ['def'], null, 2, 'Functions are defined with def.'],
  ],
  English: [
    ['mcq', 'Grammar', 'easy', 'Choose the correct form: She ___ to school every day.', ['go', 'goes', 'going', 'gone'], 1, 1, 'Third-person singular takes -es.'],
    ['mcq', 'Vocabulary', 'medium', 'Choose the synonym of "benevolent".', ['Cruel', 'Kind', 'Lazy', 'Angry'], 1, 2, 'Benevolent means well-meaning and kind.'],
    ['tf', 'Grammar', 'easy', 'A noun is a word that names a person, place or thing.', null, 'true', 1, 'That is the definition of a noun.'],
    ['multi', 'Grammar', 'medium', 'Which of these words are adjectives?', ['Quick', 'Run', 'Beautiful', 'Slowly', 'Tall'], [0, 2, 4], 3, 'Adjectives describe nouns. "Slowly" is an adverb.'],
    ['short', 'Vocabulary', 'medium', 'Write one antonym of "ancient".', ['modern', 'new', 'recent'], null, 2, 'Modern, new and recent are all acceptable.'],
    ['long', 'Writing', 'medium', 'Write a paragraph of 80 to 100 words on the importance of reading.', null, null, 5, 'Assess clarity, structure, vocabulary and word count.'],
    ['mcq', 'Literature', 'medium', 'Identify the figure of speech: "The wind whispered through the trees."', ['Simile', 'Metaphor', 'Personification', 'Hyperbole'], 2, 2, 'The wind is given a human action.'],
    ['mcq', 'Grammar', 'hard', 'Which sentence is grammatically correct?', ['Neither of the boys are ready.', 'Neither of the boys is ready.', 'Neither of the boys were ready.', 'Neither of the boys be ready.'], 1, 3, '"Neither" takes a singular verb.'],
    ['mcq', 'Grammar', 'easy', 'What is the plural of "child"?', ['Childs', 'Childes', 'Children', 'Childrens'], 2, 1, 'An irregular plural.'],
    ['tf', 'Grammar', 'medium', '"Their" and "there" have the same meaning.', null, 'false', 1, '"Their" shows possession; "there" shows place.'],
  ],
};

const CLASSES = [
  { key: '10A', name: 'Grade 10-A Mathematics', section: '10-A', subject: 'Mathematics', teacher: 1, desc: 'Algebra, coordinate geometry and trigonometry for Grade 10.',
    students: ['Ananya Iyer', 'Rohan Gupta', 'Ishita Verma', 'Kabir Malhotra', 'Meera Nair', 'Vihaan Reddy', 'Saanvi Kapoor', 'Arnav Joshi', 'Diya Patel', 'Reyansh Singh', 'Tara Menon', 'Yash Choudhary'] },
  { key: '10B', name: 'Grade 10-B Physics', section: '10-B', subject: 'Physics', teacher: 0, desc: 'Motion, forces, energy and gravitation.',
    students: ['Aarav Sharma', 'Myra Deshmukh', 'Advait Kulkarni', 'Kiara Bhatia', 'Vivaan Agarwal', 'Navya Pillai', 'Ayaan Khan', 'Riya Bansal', 'Dhruv Saxena', 'Anika Rao', 'Ishaan Mishra', 'Zoya Ansari'] },
  { key: '11A', name: 'Grade 11-A Computer Science', section: '11-A', subject: 'Computer Science', teacher: 2, desc: 'Data structures, algorithms and databases with Python.',
    students: ['Aditya Bose', 'Pooja Krishnan', 'Samar Sethi', 'Nisha Thakur', 'Kunal Shah', 'Prisha Jain', 'Manav Ghosh', 'Sanya Chawla', 'Rudra Patil', 'Aisha Fernandes'] },
  { key: '9C', name: 'Grade 9-C English', section: '9-C', subject: 'English', teacher: 2, desc: 'Grammar, comprehension and writing skills.',
    students: ['Lakshmi Narayan', 'Om Prakash', 'Pihu Arora', 'Veer Kohli', 'Aditi Rane', 'Neel Bhatt', 'Kavya Menon', 'Harsh Vardhan', 'Sia Mehra', 'Tanvi Kamat'] },
];
const TEACHERS = [['Priya Nair', 'priya.nair@school.edu', 'Science'], ['Arjun Mehta', 'arjun.mehta@school.edu', 'Mathematics'], ['Farah Khan', 'farah.khan@school.edu', 'Computer Science & English']];

const LONG = [
  'For every action there is an equal and opposite reaction. When I push a wall, the wall pushes back on my hand, and a rocket moves up because the exhaust gas is pushed down.',
  'The third law says forces come in pairs acting on different bodies. A swimmer pushes water backward and the water pushes the swimmer forward. Walking works the same way.',
  'Newton said every force has a reaction force. For example a balloon flies when air rushes out of it.',
  'Reading widens our vocabulary, builds imagination and improves concentration. A good habit of reading makes us better writers and thinkers, and it helps us learn about the world.',
  'Arrays store items in continuous memory so any item can be reached instantly by its index, but inserting in the middle is slow. Linked lists use nodes with pointers so insertion is quick, though reaching the nth item needs a walk through the list.',
  'Completing the square: divide by a, move c/a across, add (b/2a)² to both sides, take the square root and solve for x to get the formula.',
];
const FEEDBACK = ['Good explanation with clear examples.', 'Partly correct. Add a second example next time.', 'Well structured answer.', 'Correct idea, but be more precise with terminology.', 'Excellent. Full marks.'];

function run() {
  const R = mulberry32(20260919);
  const rnd = () => R();
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const now = Date.now();
  const studentHash = bcrypt.hashSync('Student@123', 10);
  const T = (o) => now + o;

  db.transaction(() => {
    /* users */
    const insUser = db.prepare('INSERT INTO users(email,name,password_hash,role,created_at) VALUES (?,?,?,?,?)');
    const adminId = insUser.run('admin@school.edu', 'Meenakshi Rao', bcrypt.hashSync('Admin@123', 10), 'admin', T(-90 * DAY)).lastInsertRowid;
    const admin = { id: adminId, name: 'Meenakshi Rao', role: 'admin' };
    const teacherPw = bcrypt.hashSync('Teacher@123', 10);
    const teachers = TEACHERS.map(([name, email, dept]) => {
      const uid = insUser.run(email, name, teacherPw, 'teacher', T(-88 * DAY)).lastInsertRowid;
      const tid = db.prepare('INSERT INTO teachers(user_id,department) VALUES (?,?)').run(uid, dept).lastInsertRowid;
      return { uid, tid, name, role: 'teacher', id: uid };
    });
    db.prepare(`INSERT INTO settings(key,value) VALUES ('demo_sim','1')`).run();

    /* classrooms + students */
    const classes = {};
    for (const c of CLASSES) {
      const cid = db.prepare('INSERT INTO classrooms(name,section,subject,teacher_id,academic_year,description,created_at) VALUES (?,?,?,?,?,?,?)')
        .run(c.name, c.section, c.subject, teachers[c.teacher].tid, '2026-27', c.desc, T(-80 * DAY)).lastInsertRowid;
      classes[c.key] = { id: cid, subject: c.subject, teacher: teachers[c.teacher], students: [], name: c.name };
      audit(admin, 'classroom.create', 'classroom', cid, c.name, null, { name: c.name, subject: c.subject }, '10.0.0.5', T(-80 * DAY));
      c.students.forEach((full, i) => {
        const email = full.toLowerCase().replace(/[^a-z ]/g, '').replace(' ', '.') + '@student.school.edu';
        const uid = insUser.run(email, full, studentHash, 'student', T(-79 * DAY)).lastInsertRowid;
        const sid = db.prepare('INSERT INTO students(user_id,roll_no,section,created_at) VALUES (?,?,?,?)').run(uid, `${c.key}-${String(i + 1).padStart(2, '0')}`, c.section, T(-79 * DAY)).lastInsertRowid;
        db.prepare('INSERT INTO classroom_students VALUES (?,?)').run(cid, sid);
        classes[c.key].students.push({ sid, uid, name: full, ability: 0.55 + rnd() * 0.43 });
      });
    }
    audit(admin, 'student.import', 'student', null, 'students-2026-27.csv', null, { created: 44, errors: 0 }, '10.0.0.5', T(-79 * DAY));

    /* question bank */
    const bank = {};
    const insQ = db.prepare(`INSERT INTO questions(subject,topic,type,text,options,correct,marks,negative_marks,difficulty,explanation,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const owner = { Physics: teachers[0], Mathematics: teachers[1], 'Computer Science': teachers[2], English: teachers[2] };
    for (const [subject, list] of Object.entries(Q)) {
      bank[subject] = list.map(([type, topic, diff, text, opts, corr, marks, expl], i) => {
        let options = null, correct = null;
        if (type === 'mcq' || type === 'multi') { options = opts.map((t, k) => ({ id: 'abcdefghij'[k], text: t })); correct = type === 'mcq' ? 'abcdefghij'[corr] : corr.map((k) => 'abcdefghij'[k]); }
        else if (type === 'tf') { options = [{ id: 'true', text: 'True' }, { id: 'false', text: 'False' }]; correct = corr; }
        else if (type === 'short') correct = opts;
        const neg = ['mcq', 'multi', 'tf'].includes(type) ? Math.round(marks * 0.25 * 100) / 100 : 0;
        const id = insQ.run(subject, topic, type, text, S(options), S(correct), marks, neg, diff, expl, owner[subject].uid, T(-70 * DAY + i * 1000), T(-70 * DAY)).lastInsertRowid;
        return { id, type, marks, neg, diff, topic, text, options, correct, expl };
      });
    }
    audit(teachers[0], 'question.create', 'question', null, '14 Physics questions', null, { count: 14 }, '10.0.0.21', T(-70 * DAY));

    /* exams */
    const insExam = db.prepare(`INSERT INTO exams(name,description,instructions,classroom_id,subject,start_at,end_at,duration_min,passing_marks,max_attempts,negative_marking,shuffle_questions,shuffle_options,release_mode,show_answers,results_released,status,paused_at,version,reminder_sent,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,?,?)`);
    const insEQ = db.prepare(`INSERT INTO exam_questions(exam_id,source_question_id,position,type,text,options,correct,marks,negative_marks,difficulty,topic,explanation,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const INSTR = 'Read every question carefully. Your answers are saved automatically. Do not refresh or close this tab. The timer is controlled by the server, so it keeps running even if your connection drops.';
    function makeExam(o) {
      const cl = classes[o.cls];
      const id = insExam.run(o.name, o.desc || null, INSTR, cl.id, cl.subject, o.start, o.end, o.duration, 0, o.maxAttempts || 1, o.neg ? 1 : 0, o.shuffleQ ? 1 : 0, o.shuffleO ? 1 : 0,
        o.release || 'manual', 1, o.released ? 1 : 0, o.status, o.version || 1, o.status === 'scheduled' ? 0 : 1, cl.teacher.uid, o.created || T(-5 * DAY), o.created || T(-5 * DAY)).lastInsertRowid;
      const eqs = o.qs.map((k, i) => {
        const q = bank[cl.subject][k];
        const eid = insEQ.run(id, q.id, i + 1, q.type, q.text, S(q.options), S(q.correct), q.marks, q.neg, q.diff, q.topic, q.expl, T(-3 * DAY)).lastInsertRowid;
        return { ...q, id: eid };
      });
      const total = eqs.reduce((a, b) => a + b.marks, 0);
      db.prepare('UPDATE exams SET total_marks=?, passing_marks=? WHERE id=?').run(total, Math.round(total * 0.4), id);
      audit(cl.teacher, 'exam.create', 'exam', id, o.name, null, { name: o.name, classroom: cl.name }, '10.0.0.21', o.created || T(-5 * DAY));
      return { ...o, id, cls: cl, eqs };
    }

    const exLive = makeExam({ cls: '10B', name: 'Physics Unit Test: Motion & Forces', desc: 'Covers kinematics, Newton\'s laws and momentum.', start: T(-25 * MIN), end: T(2 * HOUR), duration: 45, neg: true, shuffleO: true, status: 'live', version: 4, qs: [0, 1, 2, 3, 4, 5, 6, 7, 9, 10], created: T(-4 * DAY) });
    const exKin = makeExam({ cls: '10B', name: 'Kinematics Quiz', desc: 'Short quiz on motion graphs and equations.', start: T(-20 * DAY), end: T(-20 * DAY + 2 * HOUR), duration: 25, neg: false, status: 'completed', released: true, qs: [0, 1, 3, 8, 11, 12, 13], created: T(-24 * DAY) });
    const exAlg = makeExam({ cls: '10A', name: 'Algebra Unit Test 1', desc: 'Linear and quadratic equations.', start: T(-10 * DAY), end: T(-10 * DAY + 3 * HOUR), duration: 40, neg: true, shuffleQ: true, shuffleO: true, status: 'completed', released: true, qs: [0, 1, 2, 3, 4, 5, 6, 7, 8, 10], created: T(-14 * DAY) });
    const exDs = makeExam({ cls: '11A', name: 'Data Structures Test', desc: 'Stacks, queues, trees and sorting.', start: T(-5 * DAY), end: T(-5 * DAY + 3 * HOUR), duration: 40, neg: true, status: 'completed', released: false, qs: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], created: T(-9 * DAY) });
    const exGram = makeExam({ cls: '9C', name: 'Grammar Basics Quiz', desc: 'Parts of speech and sentence structure.', start: T(-14 * DAY), end: T(-14 * DAY + 2 * HOUR), duration: 30, status: 'completed', released: true, qs: [0, 2, 3, 4, 8, 9], created: T(-18 * DAY) });
    makeExam({ cls: '10A', name: 'Quadratic Equations Test', desc: 'Roots, discriminant and factorisation.', start: T(1 * DAY + 4 * HOUR), end: T(1 * DAY + 7 * HOUR), duration: 45, neg: true, status: 'scheduled', qs: [1, 2, 4, 7, 8, 10, 11], created: T(-2 * DAY) });
    makeExam({ cls: '10B', name: 'Work, Energy & Power Test', desc: 'Work-energy theorem and power.', start: T(2 * DAY + 3 * HOUR), end: T(2 * DAY + 6 * HOUR), duration: 40, neg: true, shuffleQ: true, status: 'scheduled', qs: [9, 10, 4, 7, 13, 8], created: T(-1 * DAY) });
    makeExam({ cls: '9C', name: 'Reading Comprehension Assessment', desc: 'Unseen passage with short and long answers.', start: T(3 * DAY + 2 * HOUR), end: T(3 * DAY + 5 * HOUR), duration: 50, status: 'scheduled', qs: [1, 3, 4, 5, 6, 7], created: T(-1 * DAY) });
    makeExam({ cls: '11A', name: 'Algorithms Mid-term (draft)', desc: 'Sorting, searching and complexity.', start: null, end: null, duration: 60, status: 'draft', qs: [1, 6, 8, 5], created: T(-1 * HOUR) });

    /* attempt helpers */
    const insAtt = db.prepare(`INSERT INTO attempts(exam_id,student_id,attempt_no,status,started_at,ended_at,deadline_at,question_order,seed,current_q,last_activity,restart_reason,restarted_by,restart_of,extra_ms,paused_at,pause_reason,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insAns = db.prepare('INSERT OR REPLACE INTO answers(attempt_id,exam_question_id,answer,review,visited,client_ts,updated_at) VALUES (?,?,?,?,?,?,?)');
    function makeAnswer(eq, p) {
      if (rnd() < 0.05) return null;
      const good = rnd() < p - (eq.diff === 'hard' ? 0.25 : eq.diff === 'medium' ? 0.08 : -0.05);
      if (eq.type === 'mcq' || eq.type === 'tf') return good ? eq.correct : pick(eq.options.filter((o) => o.id !== eq.correct)).id;
      if (eq.type === 'multi') { if (good) return eq.correct; const c = [...eq.correct]; c.pop(); return c.length ? c : [eq.options[0].id]; }
      if (eq.type === 'short') return good ? pick(eq.correct) : 'not sure';
      return good || rnd() < 0.7 ? pick(LONG) : 'I do not remember.';
    }
    function fillAnswers(attId, eqs, p, fraction, at) {
      const n = Math.ceil(eqs.length * fraction);
      eqs.slice(0, n).forEach((eq) => { const a = makeAnswer(eq, p); insAns.run(attId, eq.id, a == null ? null : S(a), rnd() < 0.1 ? 1 : 0, 1, at, at); });
      return n;
    }
    function manualGrade(attId, teacherUid, chance = 1) {
      const rows = db.prepare(`SELECT an.id, an.answer, eq.marks, eq.type FROM answers an JOIN exam_questions eq ON eq.id=an.exam_question_id WHERE an.attempt_id=? AND eq.type='long' AND an.answer IS NOT NULL`).all(attId);
      rows.forEach((r) => { if (rnd() > chance) return; const m = Math.round(r.marks * (0.4 + rnd() * 0.6) * 2) / 2; db.prepare('UPDATE answers SET marks_awarded=?, feedback=?, graded_by=?, graded_at=? WHERE id=?').run(m, pick(FEEDBACK), teacherUid, T(-1 * DAY), r.id); });
    }
    function finished(ex, st, opts = {}) {
      const start = ex.start + Math.floor(rnd() * 12 * MIN);
      const used = Math.floor(ex.duration * MIN * (0.5 + rnd() * 0.45));
      const timeout = opts.timeout;
      const end = timeout ? start + ex.duration * MIN : start + used;
      const status = timeout ? 'time_expired' : 'submitted';
      const attNo = opts.no || 1;
      const id = insAtt.run(ex.id, st.sid, attNo, status, start, end, start + ex.duration * MIN, S(ex.eqs.map((e) => e.id)), 1, ex.eqs.length - 1, end, null, null, opts.restartOf || null, 0, null, null, start).lastInsertRowid;
      fillAnswers(id, ex.eqs, timeout ? st.ability * 0.7 : st.ability, timeout ? 0.8 : 1, end);
      return id;
    }
    function completedExam(ex, { absent = [], timeouts = [], restartIdx = -1, gradeChance = 1 }) {
      ex.cls.students.forEach((st, i) => {
        if (absent.includes(i)) return;
        if (i === restartIdx) {
          const start = ex.start + 4 * MIN;
          const a1 = insAtt.run(ex.id, st.sid, 1, 'restarted', start, start + 12 * MIN, start + ex.duration * MIN, null, 1, 3, start + 12 * MIN, 'Power cut during the exam', ex.cls.teacher.uid, null, 0, null, null, start).lastInsertRowid;
          fillAnswers(a1, ex.eqs, st.ability, 0.4, start + 10 * MIN);
          core.gradeAttempt(a1);
          const a2 = finished(ex, st, { no: 2, restartOf: a1 });
          manualGrade(a2, ex.cls.teacher.uid, gradeChance); core.gradeAttempt(a2);
          return;
        }
        const id = finished(ex, st, { timeout: timeouts.includes(i) });
        manualGrade(id, ex.cls.teacher.uid, gradeChance); core.gradeAttempt(id);
      });
    }
    completedExam(exKin, { absent: [11], timeouts: [6] });
    completedExam(exAlg, { absent: [9], timeouts: [4], restartIdx: 3 });
    completedExam(exGram, { absent: [8], timeouts: [] });
    completedExam(exDs, { absent: [7], timeouts: [2], gradeChance: 0.45 }); // pending manual marking

    /* live physics exam */
    const cls = exLive.cls;
    const plan = ['none', 'active', 'active', 'active', 'active', 'idle', 'done', 'done', 'done', 'restarted', 'none', 'paused'];
    const seen = { live: [] };
    cls.students.forEach((st, i) => {
      const kind = plan[i];
      if (kind === 'none') return;
      const start = now - (6 + Math.floor(rnd() * 14)) * MIN;
      if (kind === 'done') {
        const end = now - Math.floor(rnd() * 5 + 1) * MIN;
        const id = insAtt.run(exLive.id, st.sid, 1, 'submitted', start - 8 * MIN, end, start - 8 * MIN + 45 * MIN, S(exLive.eqs.map((e) => e.id)), 7, 9, end, null, null, null, 0, null, null, start).lastInsertRowid;
        fillAnswers(id, exLive.eqs, st.ability, 1, end); core.gradeAttempt(id); return;
      }
      let no = 1, restartOf = null;
      if (kind === 'restarted') {
        const s0 = now - 22 * MIN;
        restartOf = insAtt.run(exLive.id, st.sid, 1, 'restarted', s0, now - 15 * MIN, s0 + 45 * MIN, S(exLive.eqs.map((e) => e.id)), 7, 2, now - 15 * MIN, 'Browser crashed and answers were lost', cls.teacher.uid, null, 0, null, null, s0).lastInsertRowid;
        fillAnswers(restartOf, exLive.eqs, st.ability, 0.3, now - 16 * MIN); core.gradeAttempt(restartOf); no = 2;
        audit(cls.teacher, 'attempt.restart', 'attempt', restartOf, `${st.name} · ${exLive.name}`, { attempt: restartOf, no: 1, status: 'in_progress' }, { reason: 'Browser crashed and answers were lost', questionSet: 'same', clearAnswers: true }, '10.0.0.21', now - 15 * MIN);
      }
      const s1 = kind === 'restarted' ? now - 14 * MIN : start;
      const paused = kind === 'paused';
      const last = kind === 'idle' ? now - 4 * MIN : now - Math.floor(rnd() * 20) * 1000;
      const id = insAtt.run(exLive.id, st.sid, no, 'in_progress', s1, null, s1 + 45 * MIN + (paused ? 3 * MIN : 0), S(exLive.eqs.map((e) => e.id)), 7, 0, last, null, null, restartOf, 0,
        paused ? now - 3 * MIN : null, paused ? 'Student reported a technical problem' : null, s1).lastInsertRowid;
      const n = fillAnswers(id, exLive.eqs, st.ability, kind === 'idle' ? 0.4 : 0.2 + rnd() * 0.6, last);
      db.prepare('UPDATE attempts SET current_q=? WHERE id=?').run(Math.min(n, exLive.eqs.length - 1), id);
      seen.live.push(id);
      if (paused) audit(cls.teacher, 'attempt.pause', 'attempt', id, `${st.name} · ${exLive.name}`, null, { reason: 'Student reported a technical problem' }, '10.0.0.21', now - 3 * MIN);
    });
    // history of live edits (kept in versions/audit trail)
    const ins = db.prepare(`INSERT INTO exam_changes(exam_id,user_id,user_name,entity,entity_id,action,field,old_value,new_value,exam_version,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    const q5 = exLive.eqs[4];
    ins.run(exLive.id, cls.teacher.uid, cls.teacher.name, 'question', q5.id, 'update', 'marks', '1', '2', 2, now - 17 * MIN);
    ins.run(exLive.id, cls.teacher.uid, cls.teacher.name, 'question', exLive.eqs[7].id, 'update', 'text', 'A 2 kg ball moving at 3 m/s collides and sticks to a 1 kg ball. What is their common velocity?', exLive.eqs[7].text, 3, now - 12 * MIN);
    ins.run(exLive.id, cls.teacher.uid, cls.teacher.name, 'exam', exLive.id, 'update', 'duration_min', '40', '45', 4, now - 9 * MIN);
    audit(cls.teacher, 'exam.live_edit', 'exam_question', q5.id, q5.text.slice(0, 80), { marks: 1 }, { marks: 2 }, '10.0.0.21', now - 17 * MIN);
    audit(cls.teacher, 'exam.live_edit', 'exam_question', exLive.eqs[7].id, exLive.eqs[7].text.slice(0, 80), { text: 'A 2 kg ball moving at 3 m/s collides and sticks to a 1 kg ball. What is their common velocity?' }, { text: exLive.eqs[7].text }, '10.0.0.21', now - 12 * MIN);
    audit(cls.teacher, 'exam.live_edit', 'exam', exLive.id, exLive.name, { duration_min: 40 }, { duration_min: 45 }, '10.0.0.21', now - 9 * MIN);
    audit(cls.teacher, 'exam.start', 'exam', exLive.id, exLive.name, { status: 'scheduled' }, { status: 'live' }, '10.0.0.21', now - 25 * MIN);

    /* more audit history */
    audit(teachers[1], 'exam.schedule', 'exam', exAlg.id, exAlg.name, { status: 'draft' }, { status: 'scheduled' }, '10.0.0.34', T(-11 * DAY));
    audit(teachers[1], 'attempt.restart', 'attempt', null, `${exAlg.cls.students[3].name} · ${exAlg.name}`, null, { reason: 'Power cut during the exam', questionSet: 'same' }, '10.0.0.34', exAlg.start + 16 * MIN);
    audit(teachers[1], 'mark.change', 'attempt', null, `${exAlg.cls.students[1].name} · ${exAlg.name}`, [{ q: 'Derive the quadratic formula…', marks: 3 }], [{ q: 'Derive the quadratic formula…', marks: 4 }], '10.0.0.34', T(-9 * DAY));
    audit(teachers[1], 'results.publish', 'exam', exAlg.id, exAlg.name, { released: 0 }, { released: 1 }, '10.0.0.34', T(-9 * DAY));
    audit(teachers[0], 'results.publish', 'exam', exKin.id, exKin.name, { released: 0 }, { released: 1 }, '10.0.0.21', T(-19 * DAY));
    audit(teachers[2], 'results.publish', 'exam', exGram.id, exGram.name, { released: 0 }, { released: 1 }, '10.0.0.41', T(-13 * DAY));
    audit(teachers[2], 'exam.complete', 'exam', exDs.id, exDs.name, { status: 'live' }, { status: 'completed' }, '10.0.0.41', exDs.end);
    audit(admin, 'auth.login', 'user', adminId, 'admin@school.edu', null, null, '10.0.0.5', T(-3 * HOUR));
    audit(admin, 'settings.update', 'settings', null, 'System settings', { idle_seconds: '120' }, { idle_seconds: '90' }, '10.0.0.5', T(-2 * DAY));
    audit(teachers[0], 'auth.login', 'user', teachers[0].uid, teachers[0].name, null, null, '10.0.0.21', T(-40 * MIN));

    /* notifications */
    const nt = db.prepare('INSERT INTO notifications(user_id,title,body,type,link,read,created_at) VALUES (?,?,?,?,?,?,?)');
    const aarav = cls.students[0];
    nt.run(aarav.uid, 'Exam started', `${exLive.name} is now open. You can begin.`, 'exam_started', '#/active', 0, now - 25 * MIN);
    nt.run(aarav.uid, 'Exam updated', `${exLive.name} was updated by your teacher. Your answers are safe.`, 'exam_changed', '#/active', 0, now - 9 * MIN);
    nt.run(aarav.uid, 'Exam scheduled', 'Work, Energy & Power Test is scheduled.', 'exam_scheduled', '#/upcoming', 1, T(-1 * DAY));
    nt.run(aarav.uid, 'Results published', 'Results for Kinematics Quiz are now available.', 'results', '#/results', 1, T(-19 * DAY));
    classes['10A'].students.forEach((s) => nt.run(s.uid, 'Exam scheduled', 'Quadratic Equations Test is scheduled for tomorrow.', 'exam_scheduled', '#/upcoming', 0, T(-2 * DAY)));
    nt.run(teachers[0].uid, 'Submission received', `${cls.students[6].name} submitted ${exLive.name}.`, 'submission', `#/live/${exLive.id}`, 0, now - 3 * MIN);
    nt.run(teachers[0].uid, 'Submission received', `${cls.students[7].name} submitted ${exLive.name}.`, 'submission', `#/live/${exLive.id}`, 0, now - 2 * MIN);
    nt.run(teachers[2].uid, 'Marking needed', 'Data Structures Test has answers waiting for manual marking.', 'alert', `#/results/${exDs.id}`, 0, T(-4 * DAY));
    nt.run(adminId, 'Live exam in progress', `${exLive.name} is running with 9 students.`, 'alert', `#/live/${exLive.id}`, 0, now - 20 * MIN);
  })();
  console.log('Demo data loaded: 4 classrooms, 44 students, 9 exams, 48 questions.');
}

module.exports = { run };
if (require.main === module) { if (db.prepare('SELECT COUNT(*) c FROM users').get().c) console.log('Database already has data. Delete data/examhub.db to reseed.'); else run(); }
