const Dagger = {
    graph: function() {
               return new Graph();
           },
};

function mk_formula(output_id, input_ids, fn) {
    return {
        output_id: output_id,
        input_ids: input_ids,
        fn: fn
    };
}

class Graph {
    constructor() {
        // map from input id to list of formulas that need recomputing
        this.inputs = {};
    }

    add(output_id, input_ids, fn) {
        let self = this;
        input_ids.forEach((id) => {
            let node = this.get_node(id);
            if (!(id in this.inputs)) {
                self.inputs[id] = [];
                node.addEventListener('change', function() {
                    self.reflow(id);
                });
            }
            self.inputs[id].push(
                mk_formula(output_id, input_ids, fn));
        });
    }

    reflow(input_id) {
        let self = this;
        this.inputs[input_id].forEach((formula) => {
           console.log(formula.input_ids);
           let args = formula.input_ids.map((id) =>
               self.get_node(id).value
           );
           let result = formula.fn.apply(null, args);
           let out = self.get_node(formula.output_id);
           out.value = result;
        });
    }

    get_node(id) {
        let a = document.getElementById(id);
        if (a == null) {
            alert(`Node id '${id}' does not exist`);
        }
        return a;
    }
}


window.Dagger = Dagger;
